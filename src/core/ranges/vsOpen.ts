import { TIERS, BB_CALL } from './yokosawa';
import type { HandClass } from '../handNotation';
import type { Position, Range } from './types';

export type VsOpenScenario = {
  id: string;
  label: string;
  heroPos: Position;
  villainPos: Position;
  range: Range;
};

/** アクション順（プリフロップ）。opener より後ろ＝この配列でindexが大きい側。 */
const POS_ORDER: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

/** opener の使用最大tier（=後ろ人数ベース）。mode.ts の BASE_MAX_TIER と一致させる。 */
const OPENER_BASE_TIER: Record<Position, number> = {
  UTG: 5, HJ: 5, CO: 6, BTN: 7, SB: 7, BB: 0,
};

/** value/bluff 3bet（固定・mode非依存・heroPos非依存）。 */
const BB_DEF_RAISE: HandClass[] = ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo', 'A5s', 'A4s'];
const RAISE_SET = new Set<HandClass>(BB_DEF_RAISE);

/** tier K..M（1始まり, 両端含む）を flat 展開。 */
function tierSlice(fromTier1: number, toTier1: number): HandClass[] {
  if (toTier1 < fromTier1) return [];
  return TIERS.slice(fromTier1 - 1, toTier1).flat();
}

/** (hero, opener) → defense Range を導出。 */
function deriveDefense(heroPos: Position, openerPos: Position): Range {
  const b = OPENER_BASE_TIER[openerPos];
  const isBB = heroPos === 'BB';
  // call の最大tier
  const callMaxTier = isBB ? Math.min(7, b + 1) : b;
  const callHands: HandClass[] = tierSlice(2, callMaxTier).filter((h) => !RAISE_SET.has(h));
  // BB が BTN のオープンに対するときのみ bbCall 層を追加
  if (isBB && openerPos === 'BTN') {
    for (const h of BB_CALL) if (!RAISE_SET.has(h)) callHands.push(h);
  }
  const range: Range = {};
  for (const h of callHands) range[h] = { call: 1 };
  for (const h of BB_DEF_RAISE) range[h] = { raise: 1 }; // raise 優先で上書き
  return range;
}

function posLabel(p: Position): string { return p; }

function buildScenarios(): VsOpenScenario[] {
  const out: VsOpenScenario[] = [];
  for (let oi = 0; oi < POS_ORDER.length; oi++) {
    const openerPos = POS_ORDER[oi];
    if (OPENER_BASE_TIER[openerPos] === 0) continue; // BB は opener にならない
    for (let hi = oi + 1; hi < POS_ORDER.length; hi++) {
      const heroPos = POS_ORDER[hi];
      out.push({
        id: `vs${openerPos}_from${heroPos}`,
        label: `vs ${posLabel(openerPos)} open（あなた${posLabel(heroPos)}）`,
        heroPos,
        villainPos: openerPos,
        range: deriveDefense(heroPos, openerPos),
      });
    }
  }
  return out;
}

export const VSOPEN_SCENARIOS: VsOpenScenario[] = buildScenarios();

export function getVsOpen(heroPos: Position, villainPos: Position): VsOpenScenario | undefined {
  return VSOPEN_SCENARIOS.find((s) => s.heroPos === heroPos && s.villainPos === villainPos);
}
