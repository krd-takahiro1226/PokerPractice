import { SUITS, rankValue, cardRank, cardSuit, type Card, type Suit } from '../cards';
import type { HandClass } from '../handNotation';
import type { Street, PlayerActionType, HandLogEntry } from '../game/types';
import type { Position } from '../ranges/types';
import type { DecisionSnapshot } from '../review/snapshot';

// ── 解析出力型（docs/SOLVER-REVIEW-DESIGN.md §3.5）─────────────────────────

export type Confidence = 'high' | 'medium' | 'low';

export type AnalysisSource = 'cfr-exact' | 'presolve' | 'range-table' | 'legacy';

export type ActionCandidate = {
  action: PlayerActionType;
  /** bet/raise の total-commit(bb) */
  sizeTo?: number;
  sizePotRatio?: number;
  /** 均衡頻度 0..1（候補合計 ~1） */
  frequency: number;
  /** 均衡EV(bb)。CFR/presolve では厳密値、range-table では未定義 */
  evBB?: number;
  explanationKeys: string[];
};

/** サブゲーム入力レンジの「仮定」を UI 開示するための記述（§5.5）。解ではない。 */
export type RangeAssumption = {
  /** 表示用ラベル 例 'BTN RFI レンジ' */
  label: string;
  /** レンジの由来 */
  origin: 'chart' | 'chart+line-rule';
  /** カードリムーバル後のコンボ数（判明していれば） */
  combos?: number;
  /** 絞り込み規則などの補足 */
  note?: string;
};

export type StrategyAdvice = {
  spot: SpotQuery;
  /** frequency 降順 */
  candidates: ActionCandidate[];
  /** 実アクションの最近傍マッチ（サイズは pot比） */
  takenCandidate: ActionCandidate | null;
  /** best.evBB - taken.evBB（EV が定義される source のみ） */
  evLossBB?: number;
  confidence: Confidence;
  source: AnalysisSource;
  /** range-table のときのみ設定。ソルバー出力由来チャートか手動チャートかを表示層が出し分けるため */
  rangeOrigin?: 'solver' | 'manual';
  /** cfr-exact のみ: 解の誤差（% of pot）と仮定レンジ（UI開示用） */
  solution?: {
    exploitabilityPctPot: number;
    heroRange: RangeAssumption;
    villainRange: RangeAssumption;
    iterations: number;
  };
};

/** snapshot → StrategyAdvice。source ごとに実装が差し替わる（§2）。 */
export type Analyzer = (snapshot: DecisionSnapshot) => StrategyAdvice;

/** 解析に必要な、snapshot に含めない付帯情報（ヒーロー自身の手札・モード・カスタムレンジ）。 */
export type AnalyzeContext = {
  heroHole: readonly [Card, Card];
  mode: import('../ranges/mode').GameMode;
  custom?: import('../ranges/effective').CustomRanges;
};

// ── SpotQuery 署名（プリソルブDBのキー。§3.6）────────────────────────────
// 後方非互換な変更は既存プリソルブDBを無効化する。フィールド順・区切り文字は
// spotQueryKey() で凍結し、types.test.ts のスナップショットで守る。

export type PotType = 'srp' | '3bp' | '4bp' | 'limped';

export type SprBucket = 'le1' | '1to3' | '3to6' | 'gt6';

export type SpotQuery = {
  street: Street;
  /** 生存者数 */
  players: number;
  potType: PotType;
  heroPos: Position;
  /** HU のみ */
  villainPos?: Position;
  ip: boolean;
  /** 現ストリートの正規化アクション列 例 'x-b66' */
  line: string;
  sprBucket: SprBucket;
  /** canonical flop キー（同型除去後）。preflop では未定義 */
  flopIso?: string;
  handClass: HandClass;
};

/** プリソルブDBのルックアップキー。**この直列化形式は世代を跨いで安定させる**。 */
export function spotQueryKey(q: SpotQuery): string {
  return [
    q.street,
    q.players,
    q.potType,
    q.heroPos,
    q.villainPos ?? '-',
    q.ip ? 'ip' : 'oop',
    q.line,
    q.sprBucket,
    q.flopIso ?? '-',
    q.handClass,
  ].join('|');
}

export function sprBucketOf(spr: number | null): SprBucket {
  if (spr === null) return 'gt6';
  if (spr <= 1) return 'le1';
  if (spr <= 3) return '1to3';
  if (spr <= 6) return '3to6';
  return 'gt6';
}

// ── flop 同型除去（スート同型で 1,755 枚に正規化）────────────────────────
// 4! 通りのスート置換のうち、正規順に並べた文字列が辞書順最小になるものを代表元に採る。
// スート置換に対して不変（＝同型フロップは同一キー）で、C(52,3) 全体で 1,755 種に収束する。

const SUIT_PERMS: Suit[][] = (() => {
  const perms: Suit[][] = [];
  const base: Suit[] = [...SUITS];
  const permute = (arr: Suit[], k: number): void => {
    if (k === arr.length) {
      perms.push([...arr]);
      return;
    }
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      permute(arr, k + 1);
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
  };
  permute(base, 0);
  return perms;
})();

function sortCardsCanonical(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const rv = rankValue(cardRank(b)) - rankValue(cardRank(a));
    if (rv !== 0) return rv;
    return SUITS.indexOf(cardSuit(a)) - SUITS.indexOf(cardSuit(b));
  });
}

/** 3枚のフロップをスート同型を除去した正規形文字列に変換する。 */
export function canonicalFlop(flop: readonly [Card, Card, Card]): string {
  let best: string | null = null;
  for (const perm of SUIT_PERMS) {
    const mapped = flop.map(
      (c) => `${cardRank(c)}${perm[SUITS.indexOf(cardSuit(c))]}` as Card,
    );
    const s = sortCardsCanonical(mapped).join('');
    if (best === null || s < best) best = s;
  }
  return best!;
}

// ── SpotQuery 構築（snapshot からの導出）──────────────────────────────────

const EPSILON = 1e-9;

/** preflop で currentBet を引き上げたエントリ列。action 名でなく amount で判定する
 *  （オープンシュート等は action='allin' でログされるため raise/bet だけ数えると漏れる）。 */
export function preflopRaiseEntries(snapshot: DecisionSnapshot): HandLogEntry[] {
  let curBet = snapshot.bb;
  const raises: HandLogEntry[] = [];
  for (const e of snapshot.actionHistory) {
    if (e.street !== 'preflop') continue;
    if (e.amount !== undefined && e.amount > curBet + EPSILON) {
      raises.push(e);
      curBet = e.amount;
    }
  }
  return raises;
}

export function classifyPotType(snapshot: DecisionSnapshot): PotType {
  const raises = preflopRaiseEntries(snapshot).length;
  if (raises === 0) return 'limped';
  if (raises === 1) return 'srp';
  if (raises === 2) return '3bp';
  return '4bp';
}

/** ポストフロップの行動順（SB→BTN）でヒーローが最後にアクションするなら IP。 */
const POSTFLOP_ORDER: Position[] = ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'];

function isHeroInPosition(snapshot: DecisionSnapshot): boolean {
  const active = snapshot.players.filter((p) => p.status !== 'folded');
  const heroIdx = POSTFLOP_ORDER.indexOf(snapshot.actor.pos);
  return active.every(
    (p) => p.playerId === snapshot.actor.playerId || POSTFLOP_ORDER.indexOf(p.pos) < heroIdx,
  );
}

/** 現ストリートの正規化アクション列。x=check c=call f=fold b<pct>=bet r<pct>=raise a=allin。
 *  pct は「そのアクション時点のポット」に対する追加投入額の比（bet 66% pot → b66）。
 *  ポストフロップ専用（全員 committedStreet=0 から始まる前提。preflop は line=''）。 */
function currentStreetLine(snapshot: DecisionSnapshot): string {
  const entries = snapshot.actionHistory.filter((e) => e.street === snapshot.street);
  if (entries.length === 0) return '';
  // 街開始時点のポットを最初のエントリの potAfter から逆算（初回投入の additional = amount）
  const committed = new Map<number, number>();
  let pot = entries[0].potAfter - (entries[0].amount ?? 0);
  const tokens = entries.map((e) => {
    const potBeforeEntry = pot;
    const additional = e.amount !== undefined ? e.amount - (committed.get(e.playerId) ?? 0) : 0;
    if (e.amount !== undefined) {
      committed.set(e.playerId, e.amount);
      pot += additional;
    }
    switch (e.action) {
      case 'check':
        return 'x';
      case 'call':
        return 'c';
      case 'fold':
        return 'f';
      case 'allin':
        return 'a';
      case 'bet':
      case 'raise': {
        const pct = potBeforeEntry > EPSILON ? Math.round((additional / potBeforeEntry) * 100) : 0;
        return `${e.action === 'bet' ? 'b' : 'r'}${pct}`;
      }
      default:
        return '?';
    }
  });
  return tokens.join('-');
}

/** snapshot と handClass から SpotQuery を組み立てる。 */
export function buildSpotQuery(snapshot: DecisionSnapshot, handClass: HandClass): SpotQuery {
  const survivors = snapshot.players.filter((p) => p.status !== 'folded');
  const villains = survivors.filter((p) => p.playerId !== snapshot.actor.playerId);
  const isHU = villains.length === 1;
  return {
    street: snapshot.street,
    players: survivors.length,
    potType: classifyPotType(snapshot),
    heroPos: snapshot.actor.pos,
    villainPos: isHU ? villains[0].pos : undefined,
    ip: snapshot.street === 'preflop' ? false : isHeroInPosition(snapshot),
    line: snapshot.street === 'preflop' ? '' : currentStreetLine(snapshot),
    sprBucket: sprBucketOf(snapshot.spr),
    flopIso:
      snapshot.street !== 'preflop' && snapshot.board.length >= 3
        ? canonicalFlop([snapshot.board[0], snapshot.board[1], snapshot.board[2]])
        : undefined,
    handClass,
  };
}
