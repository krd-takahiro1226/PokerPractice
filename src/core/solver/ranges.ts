import { cardSuit, type Card } from '../cards';
import { CATEGORY, evaluate7, handCategory } from '../evaluator';
import { handClassToCombos } from '../handNotation';
import { estimatePlayerRange } from '../ai/villainRange';
import { getSolverRange, solverRfiKey, solverVsOpenKey } from '../ranges/solverSeries';
import type { Street, HandLogEntry } from '../game/types';
import type { DecisionSnapshot } from '../review/snapshot';
import { preflopRaiseEntries, type AnalyzeContext, type RangeAssumption } from './types';
import type { WeightedCombo } from './cfr/terminal';

// サブゲーム入力レンジのモデリング MVP（docs/SOLVER-REVIEW-DESIGN.md §5.5）。
// これは「解」ではなく「仮定」であり、規則を RangeAssumption として解に添付して UI で開示する。
// プリフロップチャート起点 + 規則ベースのライン絞り込み。将来ソルバー整合的絞り込みに差し替えるため
// interface は「(snapshot) → 両者レンジ + 根拠」に固定する。

export type SubgameRange = {
  combos: WeightedCombo[];
  assumption: RangeAssumption;
};

export type SubgameRanges = {
  hero: SubgameRange;
  villain: SubgameRange;
  /** リンプポット等チャート外ラインで仮定が粗い場合 true（confidence='low' へ伝播） */
  rare: boolean;
};

/** アグレッサーの絞り込みで air（ペア未満・フラッシュドロー無し）に掛ける重み */
const AGGRESSOR_AIR_WEIGHT = 0.3;

const STREET_BOARD_LEN: Partial<Record<Street, number>> = { flop: 3, turn: 4 };

function isFlushDraw(hole: [Card, Card], board: Card[]): boolean {
  const count: Record<string, number> = {};
  for (const c of [...hole, ...board]) count[cardSuit(c)] = (count[cardSuit(c)] ?? 0) + 1;
  for (const suit of Object.keys(count)) {
    if (count[suit] >= 4 && (cardSuit(hole[0]) === suit || cardSuit(hole[1]) === suit)) return true;
  }
  return false;
}

/** bet/raise した側の air を減衰させる規則ベースの絞り込み。
 *  完成手の閾値は「ペア以上 or フラッシュドロー」という粗い規則（MVP。§5.5 の将来差し替え前提）。 */
function narrowForAggression(combos: WeightedCombo[], board: Card[]): WeightedCombo[] {
  return combos.map((c) => {
    const strong =
      handCategory(evaluate7([...c.cards, ...board])) >= CATEGORY.PAIR || isFlushDraw(c.cards, board);
    return strong ? c : { ...c, weight: c.weight * AGGRESSOR_AIR_WEIGHT };
  });
}

function expandClassWeights(classWeights: Record<string, number>): WeightedCombo[] {
  const combos: WeightedCombo[] = [];
  for (const [handClass, weight] of Object.entries(classWeights)) {
    if (weight <= 0) continue;
    for (const cards of handClassToCombos(handClass)) combos.push({ cards, weight });
  }
  return combos;
}

function wasAggressiveOn(snapshot: DecisionSnapshot, playerId: number, street: Street): boolean {
  return snapshot.actionHistory.some(
    (e) =>
      e.street === street &&
      e.playerId === playerId &&
      (e.action === 'bet' || e.action === 'raise' || e.action === 'allin'),
  );
}

function weightsFromRange(range: import('../ranges/types').Range, action: 'raise' | 'call'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [handClass, a] of Object.entries(range)) {
    const freq = a[action] ?? 0;
    if (freq > 0) out[handClass] = freq;
  }
  return out;
}

function hasWeights(w: Record<string, number>): boolean {
  return Object.keys(w).length > 0;
}

type BaseWeights = { weights: Record<string, number>; origin: 'solver' | 'manual'; sourceLabel?: string };

/** プリフロップの役割（オープナー/応答者）を判定し、可能ならソルバー系列、無ければ従来の
 *  estimatePlayerRange（villainRange.ts）にフォールバックする。役割判定規則は
 *  villainRange.ts と同一だが、同ファイルは変更禁止のためここで再判定する。 */
function preflopBaseWeights(actionHistory: HandLogEntry[], playerId: number, ctx: AnalyzeContext): BaseWeights {
  const preflopEntries = actionHistory.filter((e) => e.street === 'preflop');
  const openIndex = preflopEntries.findIndex((e) => e.action === 'raise' || e.action === 'bet');

  if (openIndex === -1) {
    return { weights: estimatePlayerRange(actionHistory, playerId, ctx.mode), origin: 'manual' };
  }
  const openEntry = preflopEntries[openIndex];

  if (openEntry.playerId === playerId) {
    const solver = getSolverRange(solverRfiKey(openEntry.pos));
    if (solver) {
      const weights = weightsFromRange(solver.range, 'raise');
      if (hasWeights(weights)) return { weights, origin: 'solver', sourceLabel: solver.meta.source };
    }
    return { weights: estimatePlayerRange(actionHistory, playerId, ctx.mode), origin: 'manual' };
  }

  const response = preflopEntries
    .slice(openIndex + 1)
    .find((e) => e.playerId === playerId && (e.action === 'raise' || e.action === 'call'));

  if (response) {
    const solver = getSolverRange(solverVsOpenKey(openEntry.pos, response.pos));
    if (solver) {
      const weights = weightsFromRange(solver.range, response.action === 'raise' ? 'raise' : 'call');
      if (hasWeights(weights)) return { weights, origin: 'solver', sourceLabel: solver.meta.source };
    }
  }

  return { weights: estimatePlayerRange(actionHistory, playerId, ctx.mode), origin: 'manual' };
}

function buildFor(snapshot: DecisionSnapshot, playerId: number, ctx: AnalyzeContext, label: string): SubgameRange {
  const { weights: base, origin, sourceLabel } = preflopBaseWeights(snapshot.actionHistory, playerId, ctx);
  let combos = expandClassWeights(base);
  const narrowedStreets: string[] = [];

  for (const street of ['flop', 'turn'] as const) {
    const len = STREET_BOARD_LEN[street]!;
    if (snapshot.board.length < len) continue;
    if (wasAggressiveOn(snapshot, playerId, street)) {
      combos = narrowForAggression(combos, snapshot.board.slice(0, len));
      narrowedStreets.push(street);
    }
  }

  const originSuffix = origin === 'solver' ? `（ソルバー由来: ${sourceLabel}）` : '';
  const assumption: RangeAssumption = {
    label: origin === 'solver' ? `${label}（ソルバー由来チャート起点）` : label,
    origin: narrowedStreets.length > 0 ? 'chart+line-rule' : 'chart',
    note:
      narrowedStreets.length > 0
        ? `${narrowedStreets.join('/')} の bet/raise により air（ペア未満・ドロー無し）を ${AGGRESSOR_AIR_WEIGHT} 倍に減衰${originSuffix}`
        : `プリフロップチャートからの推定レンジ${originSuffix}`,
  };
  return { combos, assumption };
}

/** HU サブゲームの両者入力レンジを構築する。 */
export function buildSubgameRanges(snapshot: DecisionSnapshot, ctx: AnalyzeContext): SubgameRanges | null {
  if (snapshot.context.villainIds.length !== 1) return null;
  const villainId = snapshot.context.villainIds[0];
  const villainPos = snapshot.players.find((p) => p.playerId === villainId)?.pos;
  if (!villainPos) return null;

  const hero = buildFor(snapshot, snapshot.actor.playerId, ctx, `${snapshot.actor.pos}（チャート起点）`);
  const villain = buildFor(snapshot, villainId, ctx, `${villainPos}（チャート起点）`);
  if (hero.combos.length === 0 || villain.combos.length === 0) return null;

  // リンプポット等、プリフロップに通常のオープンが無いラインはチャート仮定が粗い
  const rare = preflopRaiseEntries(snapshot).length === 0;
  return { hero, villain, rare };
}
