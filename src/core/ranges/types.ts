import type { HandClass } from '../handNotation';

export type Action = 'raise' | 'call' | 'fold';

/** Mixed-strategy frequencies; values should sum to ~1. Missing keys = fold. */
export type HandAction = { raise?: number; call?: number; fold?: number };

export type Range = Record<HandClass, HandAction>;

export type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';

export const POSITIONS: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

export const POSITION_LABEL: Record<Position, string> = {
  UTG: 'UTG',
  HJ: 'HJ',
  CO: 'CO',
  BTN: 'BTN',
  SB: 'SB',
  BB: 'BB',
};

export type RangeContext = 'RFI' | 'vsOpen';

export type Scenario = {
  id: string;
  label: string;
  heroPos: Position;
  context: RangeContext;
  /** open raise size in big blinds, for display */
  sizeBB: number;
  range: Range;
};

/** Dominant action for a hand under a range (for grid coloring). */
export function primaryAction(action: HandAction | undefined): Action {
  if (!action) return 'fold';
  const r = action.raise ?? 0;
  const c = action.call ?? 0;
  if (r === 0 && c === 0) return 'fold';
  return r >= c ? 'raise' : 'call';
}
