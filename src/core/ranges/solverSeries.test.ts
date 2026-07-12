import { describe, it, expect } from 'vitest';
import {
  getSolverRange,
  validateSolverChartData,
  solverRfiKey,
  solverVsOpenKey,
  vs3betKey,
  squeezeKey,
  vs4betKey,
} from './solverSeries';

describe('validateSolverChartData', () => {
  it('meta.source があり tables が空なら valid', () => {
    const data = {
      meta: { source: 'test-solver', method: 'cfr', generatedAt: '2026-07-10', stackBB: 100 },
      tables: {},
    };
    expect(validateSolverChartData(data)).toEqual([]);
  });

  it('meta.source が欠落しているとエラー', () => {
    const data = { meta: {}, tables: {} };
    expect(validateSolverChartData(data)).toContain('meta.source が欠落しています');
  });

  it('tables がオブジェクトでないとエラー', () => {
    const data = { meta: { source: 'x' }, tables: [] };
    const errors = validateSolverChartData(data);
    expect(errors.some((e) => e.includes('tables はオブジェクトである必要があります'))).toBe(
      true,
    );
  });

  it('未知の handClass はエラー', () => {
    const data = {
      meta: { source: 'x' },
      tables: { RFI_BTN: { XX: { raise: 1 } } },
    };
    const errors = validateSolverChartData(data);
    expect(errors.some((e) => e.includes("未知の handClass 'XX'"))).toBe(true);
  });

  it('負の頻度はエラー', () => {
    const data = {
      meta: { source: 'x' },
      tables: { RFI_BTN: { AA: { raise: -0.1 } } },
    };
    const errors = validateSolverChartData(data);
    expect(errors.some((e) => e.includes('頻度は非負の数値である必要があります'))).toBe(true);
  });

  it('頻度合計が1を超えるとエラー', () => {
    const data = {
      meta: { source: 'x' },
      tables: { RFI_BTN: { AA: { raise: 0.7, call: 0.5 } } },
    };
    const errors = validateSolverChartData(data);
    expect(errors.some((e) => e.includes('頻度の合計が1を超えています'))).toBe(true);
  });

  it('不正なキー形式はエラー (RFI_XX)', () => {
    const data = { meta: { source: 'x' }, tables: { RFI_XX: {} } };
    const errors = validateSolverChartData(data);
    expect(errors).toContain('不正なキー形式: RFI_XX');
  });

  it('不正なキー形式はエラー (FOO_BTN)', () => {
    const data = { meta: { source: 'x' }, tables: { FOO_BTN: {} } };
    const errors = validateSolverChartData(data);
    expect(errors).toContain('不正なキー形式: FOO_BTN');
  });

  it('有効な非空データは valid', () => {
    const data = {
      meta: { source: 'test-solver', method: 'cfr', generatedAt: '2026-07-10', stackBB: 100 },
      tables: {
        RFI_BTN: {
          AA: { raise: 1 },
          '72o': { raise: 0.3, fold: 0.7 },
        },
        VSOPEN_UTG_BTN: {
          KK: { raise: 0.5, call: 0.5 },
        },
      },
    };
    expect(validateSolverChartData(data)).toEqual([]);
  });

  it('data がオブジェクトでないとエラー', () => {
    expect(validateSolverChartData(null)).not.toEqual([]);
    expect(validateSolverChartData('foo')).not.toEqual([]);
  });
});

describe('getSolverRange', () => {
  it('charts.json の tables が空のため未定義を返す', () => {
    expect(getSolverRange('RFI_BTN')).toBeUndefined();
    expect(getSolverRange(solverRfiKey('UTG'))).toBeUndefined();
  });
});

describe('key helper functions', () => {
  it('solverRfiKey', () => {
    expect(solverRfiKey('BTN')).toBe('RFI_BTN');
  });

  it('solverVsOpenKey', () => {
    expect(solverVsOpenKey('UTG', 'BTN')).toBe('VSOPEN_UTG_BTN');
  });

  it('vs3betKey', () => {
    expect(vs3betKey('BTN', 'SB')).toBe('VS3BET_BTN_SB');
  });

  it('squeezeKey', () => {
    expect(squeezeKey('UTG', 'BB')).toBe('SQUEEZE_UTG_BB');
  });

  it('vs4betKey', () => {
    expect(vs4betKey('BTN', 'UTG')).toBe('VS4BET_BTN_UTG');
  });
});
