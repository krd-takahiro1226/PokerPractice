import { describe, it, expect } from 'vitest';
import { getEffectiveRange, defaultRange, rfiKey, rfiSeatKey, vsOpenKey } from './effective';
import { getRfiRange } from './rfi';
import { getVsOpen } from './vsOpen';
import { getRfiScenariosForSeats } from './seats';

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

describe('effective.ts — A-2 全人数対応', () => {
  it('rfiSeatKey は6人なら従来キー、それ以外は人数付きキーを返す', () => {
    expect(rfiSeatKey('UTG', 6)).toBe('RFI_UTG');
    expect(rfiSeatKey('UTG1', 8)).toBe('RFI_UTG1_8max');
  });

  it('defaultRange RFI_UTG_7max が getRfiScenariosForSeats(7) の UTG シナリオと一致', () => {
    const result = defaultRange('RFI_UTG_7max', 'tournament');
    const expected = getRfiScenariosForSeats(7, 'tournament').find((s) => s.heroPos === 'UTG')?.range;
    expect(result).toEqual(expected);
  });

  it('getEffectiveRange は人数付きキーでも custom を優先する', () => {
    const key = rfiSeatKey('BTN', 3);
    const customRange = { AA: { raise: 1 } } as any;
    const result = getEffectiveRange(key, 'tournament', { [key]: customRange });
    expect(result).toBe(customRange);
  });

  it('存在しないラベルの人数付きキーは undefined', () => {
    const result = defaultRange('RFI_XX_7max', 'tournament');
    expect(result).toBeUndefined();
  });
});
