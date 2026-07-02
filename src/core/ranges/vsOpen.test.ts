import { describe, it, expect } from 'vitest';
import { getVsOpen, VSOPEN_SCENARIOS, getVsOpenScenariosForSeats } from './vsOpen';
import { BB_CALL } from './yokosawa';
import { primaryAction } from './types';
import { seatLabels, playersBehind, maxTierForSeats } from './seats';

describe('vsOpen — A1 受け入れテスト', () => {
  it('1. T9o バグ回帰: BB vs CO で T9o が call', () => {
    const scenario = getVsOpen('BB', 'CO')!;
    expect(scenario).toBeDefined();
    expect(primaryAction(scenario.range['T9o'])).toBe('call');
  });

  it('2. 3bet 固定: value ハンドが raise', () => {
    const scenario = getVsOpen('BB', 'BTN')!;
    for (const h of ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo']) {
      expect(scenario.range[h]?.raise, `${h} should be raise`).toBe(1);
    }
    expect(scenario.range['A5s']?.raise).toBe(1);
    expect(scenario.range['A4s']?.raise).toBe(1);
    expect(primaryAction(scenario.range['A3s'])).toBe('call');
    expect(primaryAction(scenario.range['T8s'])).toBe('call');
  });

  it('3. BB vs BTN の bbCall 層が含まれ、BB vs CO には含まれない', () => {
    const btn = getVsOpen('BB', 'BTN')!;
    // BB_CALL 由来のハンド（A2o, 87o はRaise対象外なのでcallになるはず）
    expect(primaryAction(btn.range['A2o'])).toBe('call');
    expect(primaryAction(btn.range['87o'])).toBe('call');
    const co = getVsOpen('BB', 'CO')!;
    // BB vs CO には bbCall 層なし（A2o は fold）
    expect(primaryAction(co.range['A2o'])).toBe('fold');
  });

  it('4. 網羅: 全15組合せが VSOPEN_SCENARIOS に存在する', () => {
    expect(VSOPEN_SCENARIOS).toHaveLength(15);
    // id フォーマット
    for (const s of VSOPEN_SCENARIOS) {
      expect(s.id).toBe(`vs${s.villainPos}_from${s.heroPos}`);
    }
  });

  it('5. 非BBは +1 しない: BTN vs CO の callMaxTier=6（tier7 の 54s が含まれない）', () => {
    const btnVsCo = getVsOpen('BTN', 'CO')!;
    // tier7 のハンド 54s は含まれない
    expect(primaryAction(btnVsCo.range['54s'])).toBe('fold');
    // SB vs BTN: b=7, callMaxTier=7（+1しない）
    const sbVsBtn = getVsOpen('SB', 'BTN')!;
    // tier7 の A6o は含まれる（b=7, callMaxTier=7）
    expect(primaryAction(sbVsBtn.range['A6o'])).toBe('call');
  });

  it('6. raise/call 排他: 全 scenario で同一ハンドに raise と call が同時に立たない', () => {
    for (const s of VSOPEN_SCENARIOS) {
      for (const [h, action] of Object.entries(s.range)) {
        const hasRaise = (action.raise ?? 0) > 0;
        const hasCall = (action.call ?? 0) > 0;
        expect(hasRaise && hasCall, `${s.id}: ${h} に raise と call の両方が立っている`).toBe(false);
      }
    }
  });

  it('7. 参照同一性: getVsOpen が VSOPEN_SCENARIOS の同一オブジェクトを返す', () => {
    const found = VSOPEN_SCENARIOS.find((s) => s.heroPos === 'BB' && s.villainPos === 'CO');
    const got = getVsOpen('BB', 'CO');
    expect(got).toBe(found);
  });
});

describe('getVsOpenScenariosForSeats', () => {
  it('n=6: deep equal to VSOPEN_SCENARIOS (id, heroPos, villainPos, range)', () => {
    const scenarios = getVsOpenScenariosForSeats(6);
    expect(scenarios).toHaveLength(VSOPEN_SCENARIOS.length);
    for (let i = 0; i < VSOPEN_SCENARIOS.length; i++) {
      expect(scenarios[i].id).toBe(VSOPEN_SCENARIOS[i].id);
      expect(scenarios[i].heroPos).toBe(VSOPEN_SCENARIOS[i].heroPos);
      expect(scenarios[i].villainPos).toBe(VSOPEN_SCENARIOS[i].villainPos);
      expect(scenarios[i].range).toEqual(VSOPEN_SCENARIOS[i].range);
    }
  });

  it('n=9: BB vs BTN には BB_CALL のハンドが含まれる', () => {
    const scenarios = getVsOpenScenariosForSeats(9);
    const bbVsBtn = scenarios.find(s => s.heroPos === 'BB' && s.villainPos === 'BTN')!;
    expect(bbVsBtn).toBeDefined();
    // BB_CALL hand that is not in RAISE_SET
    expect(primaryAction(bbVsBtn.range['A2o'])).toBe('call');
  });

  it('n=2 (HU): BB vs SB に BB_CALL 層が適用される（SB がボタン）', () => {
    const scenarios = getVsOpenScenariosForSeats(2);
    expect(scenarios).toHaveLength(1);
    const huBB = scenarios[0];
    expect(huBB.heroPos).toBe('BB');
    expect(huBB.villainPos).toBe('SB');
    expect(primaryAction(huBB.range['A2o'])).toBe('call');
  });

  it('n=9: 非BB hero の callMaxTier が opener の base tier と一致', () => {
    const scenarios = getVsOpenScenariosForSeats(9);
    // non-BB heroes should have callMaxTier === opener's base tier
    const nonBBScenarios = scenarios.filter(s => s.heroPos !== 'BB');
    for (const s of nonBBScenarios) {
      const n9labels = seatLabels(9);
      const openerIdx = n9labels.indexOf(s.villainPos);
      const b = playersBehind(9, openerIdx);
      const expectedCallMaxTier = maxTierForSeats(b);
      expect(s.callMaxTier).toBe(expectedCallMaxTier);
    }
  });
});
