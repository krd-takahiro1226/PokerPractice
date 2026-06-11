import { TIERS } from './yokosawa';
import { maxTierFor, type GameMode } from './mode';
import type { HandClass } from '../handNotation';
import type { Position, Range, Scenario } from './types';

const RFI_POSITIONS: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB'];

/** モード×ポジション → 累積ティアを展開した HandClass 配列。 */
export function rfiHandClasses(mode: GameMode, pos: Position): HandClass[] {
  const maxTier = maxTierFor(mode, pos);
  if (maxTier === 0) return [];
  return TIERS.slice(0, maxTier).flat();
}

/** モード×ポジション → pure-raise Range。 */
export function getRfiRange(mode: GameMode, pos: Position): Range {
  const range: Range = {};
  for (const h of rfiHandClasses(mode, pos)) range[h] = { raise: 1 };
  return range;
}

const OPEN_SIZE: Record<Position, number> = {
  UTG: 2.5, HJ: 2.5, CO: 2.5, BTN: 2.5, SB: 3.0, BB: 0,
};

const POS_LABEL_JA: Record<Position, string> = {
  UTG: 'UTG', HJ: 'HJ', CO: 'CO', BTN: 'BTN', SB: 'SB', BB: 'BB',
};

/**
 * scenario id は **モードに依存しない**（'RFI_UTG' 等）。
 * Home.tsx の弱点ラベル参照（byScenario のキー）が壊れないようにするため。
 * モードは Range の中身だけに反映する。
 */
export function getRfiScenarios(mode: GameMode): Scenario[] {
  return RFI_POSITIONS.map((pos) => ({
    id: `RFI_${pos}`,
    label: `${POS_LABEL_JA[pos]} オープン`,
    heroPos: pos,
    context: 'RFI' as const,
    sizeBB: OPEN_SIZE[pos],
    range: getRfiRange(mode, pos),
  }));
}

/** 後方互換: 既定モード = tournament の RFI_SCENARIOS。 */
export const RFI_SCENARIOS: Scenario[] = getRfiScenarios('tournament');
