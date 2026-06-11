import { describe, it, expect } from 'vitest';
import { getEffectiveRange, defaultRange, rfiKey, vsOpenKey } from './effective';
import { getRfiRange } from './rfi';
import { getVsOpen } from './vsOpen';

describe('effective.ts — A3 受け入れテスト', () => {
  it('getEffectiveRange RFI_UTG tournament がデフォルト導出と一致', () => {
    const key = rfiKey('UTG');
    const result = getEffectiveRange(key, 'tournament');
    const expected = getRfiRange('tournament', 'UTG');
    expect(result).toEqual(expected);
  });

  it('custom を渡すと custom を返す', () => {
    const key = rfiKey('UTG');
    const customRange = { AA: { raise: 1 } } as any;
    const result = getEffectiveRange(key, 'tournament', { [key]: customRange });
    expect(result).toBe(customRange);
  });

  it('空 custom ({}) は無視してデフォルト', () => {
    const key = rfiKey('CO');
    const result = getEffectiveRange(key, 'tournament', { [key]: {} as any });
    const expected = getRfiRange('tournament', 'CO');
    expect(result).toEqual(expected);
  });

  it('vsOpenKey/rfiKey の往復', () => {
    expect(rfiKey('UTG')).toBe('RFI_UTG');
    expect(vsOpenKey('CO', 'BB')).toBe('VSOPEN_CO_BB');
  });

  it('defaultRange VSOPEN_CO_BB が getVsOpen("BB","CO").range と一致', () => {
    const result = defaultRange('VSOPEN_CO_BB', 'tournament');
    const expected = getVsOpen('BB', 'CO')?.range;
    expect(result).toBe(expected);
  });
});
