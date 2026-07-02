import type { GameMode } from './mode';
import { TIERS } from './yokosawa';
import type { Range } from './types';

export type SeatLabel = string;

/** 人数 n（2..10）に応じた席ラベル配列をアクション順（UTG→…→BB）で返す。 */
export function seatLabels(n: number): SeatLabel[] {
  switch (n) {
    case 2: return ['SB', 'BB'];
    case 3: return ['BTN', 'SB', 'BB'];
    case 4: return ['CO', 'BTN', 'SB', 'BB'];
    case 5: return ['HJ', 'CO', 'BTN', 'SB', 'BB'];
    case 6: return ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    case 7: return ['UTG', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    case 8: return ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    case 9: return ['UTG', 'UTG1', 'UTG2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    case 10: return ['UTG', 'UTG1', 'UTG2', 'UTG3', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    default: return ['SB', 'BB'];
  }
}

/** 席ラベルの「後ろの人数 b」= seatLabels(n) の index から。 */
export function playersBehind(n: number, seatIndex: number): number {
  return n - 1 - seatIndex;
}

/** 後ろ人数 b → 使用最大tier番号(1..7)。tournament/cash-ante 基準。 */
export function maxTierForSeats(b: number): number {
  if (b >= 8) return 3;
  if (b >= 6) return 4;
  if (b >= 4) return 5;
  if (b === 3) return 6;
  return 7;
}

/** cash-noante は 1 tier タイト化。 */
export function maxTierForSeatsMode(b: number, mode: GameMode): number {
  const base = maxTierForSeats(b);
  return mode === 'cash-noante' ? base - 1 : base;
}

export type SeatScenario = {
  id: string;
  label: string;
  heroPos: SeatLabel;
  range: Range;
  sizeBB: number;
  maxTier: number;
};

/** 人数 n・モード mode → BBを除く全席のRFIシナリオ配列（アクション順）。HUではSBがオープナー。 */
export function getRfiScenariosForSeats(n: number, mode: GameMode): SeatScenario[] {
  const labels = seatLabels(n);
  return labels
    .map((label, idx) => ({ label, idx }))
    .filter(({ label }) => label !== 'BB')
    .map(({ label, idx }) => {
      const b = playersBehind(n, idx);
      const maxTier = maxTierForSeatsMode(b, mode);
      const range: Range = {};
      for (const hand of TIERS.slice(0, maxTier).flat()) range[hand] = { raise: 1 };
      return {
        // n=6 は既存 getRfiScenarios の id（'RFI_UTG' 等）と揃える
        id: n === 6 ? `RFI_${label}` : `RFI_${label}_${n}max`,
        label: `${label} オープン`,
        heroPos: label,
        range,
        sizeBB: label === 'SB' ? 3.0 : 2.5,
        maxTier,
      };
    });
}
