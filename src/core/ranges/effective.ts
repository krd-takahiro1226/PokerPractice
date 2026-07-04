import { getRfiRange } from './rfi';
import { getRfiScenariosForSeats } from './seats';
import { getVsOpen } from './vsOpen';
import type { GameMode } from './mode';
import type { Position, Range } from './types';

/**
 * RFI: `RFI_<pos>`（6max・保存済みデータ互換）または `RFI_<label>_<n>max`（6max以外）。
 * vsOpen: `VSOPEN_<opener>_<hero>`。
 */
export type RangeKey = `RFI_${string}` | `VSOPEN_${Position}_${Position}`;

export type CustomRanges = Partial<Record<RangeKey, Range>>;

export function rfiKey(pos: Position): RangeKey { return `RFI_${pos}`; }

/** n=6 は従来キー（保存済みデータ互換）、それ以外は人数付きキー。 */
export function rfiSeatKey(label: string, seatCount: number): RangeKey {
  return seatCount === 6 ? `RFI_${label}` : `RFI_${label}_${seatCount}max`;
}

export function vsOpenKey(opener: Position, hero: Position): RangeKey {
  return `VSOPEN_${opener}_${hero}`;
}

const RFI_SEAT_KEY_RE = /^RFI_(.+)_(\d+)max$/;

/** デフォルト導出（custom なし）。RFI は mode 依存、vsOpen は mode 非依存。 */
export function defaultRange(key: RangeKey, mode: GameMode): Range | undefined {
  if (key.startsWith('RFI_')) {
    const seatMatch = key.match(RFI_SEAT_KEY_RE);
    if (seatMatch) {
      const [, label, seatCountStr] = seatMatch;
      const seatCount = Number(seatCountStr);
      const scenario = getRfiScenariosForSeats(seatCount, mode).find((s) => s.heroPos === label);
      return scenario?.range;
    }
    const pos = key.slice(4) as Position;
    return getRfiRange(mode, pos);
  }
  // VSOPEN_<opener>_<hero>
  const [, opener, hero] = key.split('_') as [string, Position, Position];
  return getVsOpen(hero, opener)?.range;
}

/** custom があれば優先、無ければデフォルト導出。 */
export function getEffectiveRange(
  key: RangeKey,
  mode: GameMode,
  custom?: CustomRanges,
): Range | undefined {
  const c = custom?.[key];
  if (c && Object.keys(c).length > 0) return c;
  return defaultRange(key, mode);
}
