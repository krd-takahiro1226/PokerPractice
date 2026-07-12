import { cardsToHandClass, type HandClass } from '../handNotation';
import type { PlayerActionType } from '../game/types';
import type { DecisionSnapshot } from '../review/snapshot';
import { matchTaken } from './cfr/advice';
import {
  buildSpotQuery,
  type ActionCandidate,
  type AnalyzeContext,
  type Confidence,
  type SpotQuery,
  type StrategyAdvice,
} from './types';

// L3: flop プリソルブDB lookup（docs/SOLVER-REVIEW-DESIGN.md §12.3, §12.4）。
// データは public/presolve/<config>/<flopIso>.json（flop 単位シャーディング）。
// preloadPresolve（async・fetcher 注入）でキャッシュへロードし、lookupPresolve は
// analyzeSnapshot の同期性を守るためキャッシュのみを参照する。
// ミスマッチ・欠損は null を返し、呼び出し側が legacy にフォールバックする。

export type PresolveFetcher = (path: string) => Promise<unknown | null>;

export type PresolveMeta = {
  config: string;
  potType: string;
  positions: { ip: string; oop: string };
  sprBucket: string;
  flops: Record<string, unknown>;
};

export type PresolveNode = {
  actor: 'oop' | 'ip';
  actions: string[];
  strat: Record<HandClass, number[]>;
};

export type PresolveFlopFile = {
  v: number;
  flop: string;
  nodes: Record<string, PresolveNode>;
};

/** 同梱済みのプリソルブ構成。追加時はここに列挙する。 */
const KNOWN_CONFIGS = ['srp-btn-bb'];

/** b/r トークンのサイズ近傍マッチの許容相対誤差（§12.3: 相対 40% 以内） */
const SIZE_MATCH_REL_TOLERANCE = 0.4;
/** 完全一致とみなす丸め誤差（±2pct） */
const SIZE_EXACT_ABS_TOLERANCE = 2;

const EPS = 1e-9;

let fetcher: PresolveFetcher | null = null;
/** null = negative キャッシュ（fetch 失敗・ファイル欠損） */
const metaCache = new Map<string, PresolveMeta | null>();
const flopCache = new Map<string, PresolveFlopFile | null>();

export function setPresolveFetcher(f: PresolveFetcher): void {
  fetcher = f;
}

export function _resetPresolveForTest(): void {
  fetcher = null;
  metaCache.clear();
  flopCache.clear();
}

function isMeta(v: unknown): v is PresolveMeta {
  const m = v as PresolveMeta;
  return (
    typeof m === 'object' &&
    m !== null &&
    typeof m.potType === 'string' &&
    typeof m.sprBucket === 'string' &&
    typeof m.positions === 'object' &&
    m.positions !== null &&
    typeof m.positions.ip === 'string' &&
    typeof m.positions.oop === 'string'
  );
}

function isFlopFile(v: unknown): v is PresolveFlopFile {
  const f = v as PresolveFlopFile;
  return typeof f === 'object' && f !== null && f.v === 1 && typeof f.nodes === 'object' && f.nodes !== null;
}

async function loadMeta(config: string): Promise<PresolveMeta | null> {
  const cached = metaCache.get(config);
  if (cached !== undefined) return cached;
  let meta: PresolveMeta | null = null;
  try {
    const raw = await fetcher?.(`${config}/meta.json`);
    if (isMeta(raw)) meta = raw;
  } catch {
    // 解析は落とさない（negative キャッシュへ）
  }
  metaCache.set(config, meta);
  return meta;
}

async function loadFlop(config: string, flopIso: string): Promise<void> {
  const key = `${config}/${flopIso}`;
  if (flopCache.has(key)) return;
  let file: PresolveFlopFile | null = null;
  try {
    const raw = await fetcher?.(`${config}/${flopIso}.json`);
    if (isFlopFile(raw)) file = raw;
  } catch {
    // negative キャッシュへ
  }
  flopCache.set(key, file);
}

/** meta とスポットの構成（potType・両者ポジション・SPRバケット）が一致するか。 */
function configMatches(meta: PresolveMeta, spot: SpotQuery): boolean {
  if (meta.potType !== spot.potType) return false;
  if (meta.sprBucket !== spot.sprBucket) return false;
  const heroExpected = spot.ip ? meta.positions.ip : meta.positions.oop;
  const villainExpected = spot.ip ? meta.positions.oop : meta.positions.ip;
  return spot.heroPos === heroExpected && spot.villainPos === villainExpected;
}

function isHuFlopSnapshot(snapshot: DecisionSnapshot): boolean {
  return (
    snapshot.street === 'flop' &&
    !snapshot.context.isMultiway &&
    snapshot.context.villainIds.length === 1 &&
    snapshot.board.length >= 3
  );
}

/** HU flop 判断を含む snapshot 群から、構成マッチする flop ファイル + meta をキャッシュへロードする。
 *  ファイル欠損・fetch 失敗は握りつぶして negative 登録し、解析全体は落とさない。 */
export async function preloadPresolve(snapshots: DecisionSnapshot[]): Promise<void> {
  if (!fetcher) return;
  const targets = snapshots.filter(isHuFlopSnapshot);
  if (targets.length === 0) return;

  for (const config of KNOWN_CONFIGS) {
    const meta = await loadMeta(config);
    if (!meta) continue;
    for (const snapshot of targets) {
      // handClass はファイル選択に無関係のためプレースホルダで組み立てる
      const spot = buildSpotQuery(snapshot, 'AA');
      if (!spot.flopIso || !configMatches(meta, spot)) continue;
      await loadFlop(config, spot.flopIso);
    }
  }
}

type SizeToken = { kind: 'b' | 'r'; pct: number };
type ParsedToken = { kind: 'x' | 'c' | 'f' | 'a' } | SizeToken;

function parseToken(tok: string): ParsedToken | null {
  if (tok === 'x' || tok === 'c' || tok === 'f' || tok === 'a') return { kind: tok };
  const m = tok.match(/^([br])(\d+)$/);
  if (!m) return null;
  return { kind: m[1] as 'b' | 'r', pct: Number(m[2]) };
}

function isSizeToken(t: ParsedToken): t is SizeToken {
  return t.kind === 'b' || t.kind === 'r';
}

type LineResolution = { dbLine: string; approx: boolean };

/** snapshot の line を DB のノードキーへトークン単位で解決する。
 *  x/c/f/a は完全一致、b/r は同種トークンの利用可能サイズへ相対誤差40%以内の最近傍。 */
function resolveLine(nodes: Record<string, PresolveNode>, line: string): LineResolution | null {
  const tokens = line === '' ? [] : line.split('-');
  const resolved: string[] = [];
  let approx = false;

  for (const tok of tokens) {
    const parsed = parseToken(tok);
    if (!parsed) return null;
    const node = nodes[resolved.join('-')];
    if (!node) return null;

    if (!isSizeToken(parsed)) {
      if (!node.actions.includes(parsed.kind)) return null;
      resolved.push(parsed.kind);
      continue;
    }

    const actualPct = parsed.pct;
    let best: { token: string; pct: number } | null = null;
    for (const a of node.actions) {
      const cand = parseToken(a);
      if (!cand || !isSizeToken(cand) || cand.kind !== parsed.kind) continue;
      if (best === null || Math.abs(cand.pct - actualPct) < Math.abs(best.pct - actualPct)) {
        best = { token: a, pct: cand.pct };
      }
    }
    if (!best) return null;
    const diff = Math.abs(best.pct - actualPct);
    if (diff > SIZE_EXACT_ABS_TOLERANCE) {
      if (diff / actualPct > SIZE_MATCH_REL_TOLERANCE) return null;
      approx = true;
    }
    resolved.push(best.token);
  }

  return { dbLine: resolved.join('-'), approx };
}

const TOKEN_TO_ACTION: Record<string, PlayerActionType> = {
  x: 'check',
  c: 'call',
  f: 'fold',
  a: 'allin',
  b: 'bet',
  r: 'raise',
};

function demote(c: Confidence): Confidence {
  return c === 'high' ? 'medium' : 'low';
}

/** プリソルブDBの同期 lookup（§12.3）。キャッシュ未ロード・構成不一致・line 解決不能は null。 */
export function lookupPresolve(snapshot: DecisionSnapshot, ctx: AnalyzeContext): StrategyAdvice | null {
  if (!isHuFlopSnapshot(snapshot)) return null;

  const handClass = cardsToHandClass(ctx.heroHole[0], ctx.heroHole[1]);
  const spot = buildSpotQuery(snapshot, handClass);
  if (!spot.flopIso || spot.players !== 2) return null;

  for (const config of KNOWN_CONFIGS) {
    const meta = metaCache.get(config);
    if (!meta || !configMatches(meta, spot)) continue;
    const file = flopCache.get(`${config}/${spot.flopIso}`);
    if (!file) continue;

    const resolution = resolveLine(file.nodes, spot.line);
    if (!resolution) continue;
    const node = file.nodes[resolution.dbLine];
    if (!node) continue;
    // DB ノードの手番と snapshot のヒーロー手番の食い違いはデータ不整合
    if (node.actor !== (spot.ip ? 'ip' : 'oop')) continue;

    const freqs = node.strat[handClass];
    if (!freqs || freqs.length !== node.actions.length) continue;

    const heroSeat = snapshot.players.find((p) => p.playerId === snapshot.actor.playerId);
    if (!heroSeat) continue;

    const explanationKeys = resolution.approx
      ? ['presolve-strategy', 'presolve-size-approx']
      : ['presolve-strategy'];

    const candidates: (ActionCandidate & { add: number })[] = [];
    for (let i = 0; i < node.actions.length; i++) {
      const parsed = parseToken(node.actions[i]);
      if (!parsed) return null;
      let add = 0;
      if (parsed.kind === 'c') add = Math.min(snapshot.toCall, heroSeat.stack);
      else if (parsed.kind === 'a') add = heroSeat.stack;
      else if (isSizeToken(parsed)) add = (parsed.pct / 100) * snapshot.potBefore;
      const aggressive = parsed.kind === 'b' || parsed.kind === 'r' || parsed.kind === 'a';
      candidates.push({
        action: TOKEN_TO_ACTION[parsed.kind],
        sizeTo: aggressive && add > EPS ? heroSeat.committedStreet + add : undefined,
        sizePotRatio: aggressive && add > EPS ? add / snapshot.potBefore : undefined,
        frequency: freqs[i],
        explanationKeys,
        add,
      });
    }
    candidates.sort((a, b) => b.frequency - a.frequency);

    const takenCandidate = matchTaken(snapshot, candidates);

    let confidence: Confidence = resolution.approx ? 'medium' : 'high';
    if (snapshot.reliability === 'approx') confidence = demote(confidence);

    const strip = ({ add: _add, ...c }: ActionCandidate & { add: number }): ActionCandidate => c;
    return {
      spot,
      candidates: candidates.map(strip),
      takenCandidate: takenCandidate ? strip(takenCandidate) : null,
      confidence,
      source: 'presolve',
    };
  }
  return null;
}
