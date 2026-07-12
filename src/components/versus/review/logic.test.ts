import { describe, it, expect } from 'vitest';
import { verdictOfAdvice, summarizeAnalysis, sourceChipLabel } from './logic';
import type { StrategyAdvice, ActionCandidate, AnalyzedDecision, SpotQuery } from '../../../core/solver';
import type { DecisionSnapshot } from '../../../core/review/snapshot';

function candidate(overrides: Partial<ActionCandidate> = {}): ActionCandidate {
  return {
    action: 'call',
    frequency: 0.5,
    explanationKeys: [],
    ...overrides,
  };
}

const DUMMY_SPOT: SpotQuery = {
  street: 'river',
  players: 2,
  potType: 'srp',
  heroPos: 'BB',
  villainPos: 'BTN',
  ip: false,
  line: 'x',
  sprBucket: '1to3',
  handClass: 'AKs',
};

function advice(overrides: Partial<StrategyAdvice> = {}): StrategyAdvice {
  return {
    spot: DUMMY_SPOT,
    candidates: [candidate()],
    takenCandidate: candidate(),
    confidence: 'high',
    source: 'cfr-exact',
    ...overrides,
  };
}

function snapshot(overrides: Partial<DecisionSnapshot> = {}): DecisionSnapshot {
  return {
    logIndex: 0,
    street: 'river',
    actor: { playerId: 0, pos: 'BB', isHero: true },
    board: [],
    potBefore: 10,
    toCall: 0,
    legal: {
      canFold: true,
      canCheck: true,
      canCall: false,
      callAmount: 0,
      canBet: true,
      canRaise: false,
      minBetTo: 1,
      maxBetTo: 100,
    },
    players: [],
    effectiveStack: 100,
    spr: 10,
    bb: 1,
    actionHistory: [],
    context: {
      heroHasInitiative: false,
      villainIds: [1],
      isMultiway: false,
    },
    taken: { action: 'call' },
    reliability: 'exact',
    ...overrides,
  };
}

function decision(overrides: {
  snapshotOverrides?: Partial<DecisionSnapshot>;
  adviceOverrides?: Partial<StrategyAdvice>;
} = {}): AnalyzedDecision {
  return {
    snapshot: snapshot(overrides.snapshotOverrides),
    advice: advice(overrides.adviceOverrides),
  };
}

describe('verdictOfAdvice', () => {
  it('source=legacy は候補があっても info', () => {
    const a = advice({ source: 'legacy', candidates: [candidate({ frequency: 1 })], takenCandidate: candidate({ frequency: 1 }) });
    expect(verdictOfAdvice(a)).toBe('info');
  });

  it('candidates が空なら info', () => {
    const a = advice({ candidates: [], takenCandidate: null });
    expect(verdictOfAdvice(a)).toBe('info');
  });

  it('frequency=0.6 ちょうどは good（境界値）', () => {
    const a = advice({ takenCandidate: candidate({ frequency: 0.6 }) });
    expect(verdictOfAdvice(a)).toBe('good');
  });

  it('frequency=0.59999 は good に届かず ok（evLoss未定義）', () => {
    const a = advice({ takenCandidate: candidate({ frequency: 0.59999 }) });
    expect(verdictOfAdvice(a)).toBe('ok');
  });

  it('evLossBB=0.15 ちょうどは good（境界値）', () => {
    const a = advice({ takenCandidate: candidate({ frequency: 0.1 }), evLossBB: 0.15 });
    expect(verdictOfAdvice(a)).toBe('good');
  });

  it('evLossBB=0.16・frequency低めは ok（evLoss<=0.75 の OR 条件）', () => {
    const a = advice({ takenCandidate: candidate({ frequency: 0.1 }), evLossBB: 0.16 });
    expect(verdictOfAdvice(a)).toBe('ok');
  });

  it('frequency=0.2 ちょうどは ok（境界値）', () => {
    const a = advice({ takenCandidate: candidate({ frequency: 0.2 }) });
    expect(verdictOfAdvice(a)).toBe('ok');
  });

  it('evLossBB=0.75 ちょうどは ok（境界値）', () => {
    const a = advice({ takenCandidate: candidate({ frequency: 0.1 }), evLossBB: 0.75 });
    expect(verdictOfAdvice(a)).toBe('ok');
  });

  it('evLossBB=0.76・frequency<0.2 は mistake', () => {
    const a = advice({ takenCandidate: candidate({ frequency: 0.1 }), evLossBB: 0.76 });
    expect(verdictOfAdvice(a)).toBe('mistake');
  });

  it('frequency=0.19999・evLossBB未定義は mistake', () => {
    const a = advice({ takenCandidate: candidate({ frequency: 0.19999 }), evLossBB: undefined });
    expect(verdictOfAdvice(a)).toBe('mistake');
  });

  it('takenCandidate=null かつ evLossBB=0.1 は good', () => {
    const a = advice({ takenCandidate: null, evLossBB: 0.1 });
    expect(verdictOfAdvice(a)).toBe('good');
  });

  it('takenCandidate=null かつ evLossBB=0.5 は ok', () => {
    const a = advice({ takenCandidate: null, evLossBB: 0.5 });
    expect(verdictOfAdvice(a)).toBe('ok');
  });

  it('takenCandidate=null かつ evLossBB=0.9 は mistake', () => {
    const a = advice({ takenCandidate: null, evLossBB: 0.9 });
    expect(verdictOfAdvice(a)).toBe('mistake');
  });

  it('takenCandidate=null かつ evLossBB未定義は不確実なため ok（誤ってミス表示しない）', () => {
    const a = advice({ takenCandidate: null, evLossBB: undefined });
    expect(verdictOfAdvice(a)).toBe('ok');
  });
});

describe('summarizeAnalysis', () => {
  it('legacy の判断は counts・totalEvLossBB に加算されない', () => {
    const decisions: AnalyzedDecision[] = [
      decision({ adviceOverrides: { source: 'legacy', candidates: [], takenCandidate: null, evLossBB: 5 } }),
      decision({ adviceOverrides: { takenCandidate: candidate({ frequency: 0.9 }) } }),
    ];
    const summary = summarizeAnalysis(decisions);
    expect(summary.counts.info).toBe(0);
    expect(summary.counts.good).toBe(1);
    expect(summary.totalEvLossBB).toBe(0);
  });

  it('counts は good/ok/mistake/info の出現数を集計する', () => {
    const decisions: AnalyzedDecision[] = [
      decision({ adviceOverrides: { takenCandidate: candidate({ frequency: 0.9 }) } }), // good
      decision({ adviceOverrides: { takenCandidate: candidate({ frequency: 0.3 }) } }), // ok
      decision({
        adviceOverrides: { takenCandidate: candidate({ frequency: 0.1 }), evLossBB: 1.0 },
      }), // mistake
    ];
    const summary = summarizeAnalysis(decisions);
    expect(summary.counts).toEqual({ good: 1, ok: 1, mistake: 1, info: 0 });
  });

  it('totalEvLossBB は evLossBB が定義された判断のみ合計する', () => {
    const decisions: AnalyzedDecision[] = [
      decision({ adviceOverrides: { takenCandidate: candidate({ frequency: 0.9 }), evLossBB: 0.1 } }),
      decision({ adviceOverrides: { takenCandidate: candidate({ frequency: 0.9 }), evLossBB: undefined } }),
      decision({ adviceOverrides: { takenCandidate: candidate({ frequency: 0.9 }), evLossBB: 0.2 } }),
    ];
    const summary = summarizeAnalysis(decisions);
    expect(summary.totalEvLossBB).toBeCloseTo(0.3);
  });

  it('worst は mistake の中で evLossBB が最大のものを返す', () => {
    const decisions: AnalyzedDecision[] = [
      decision({
        snapshotOverrides: { logIndex: 1, street: 'flop' },
        adviceOverrides: { takenCandidate: candidate({ frequency: 0.1 }), evLossBB: 1.2 },
      }),
      decision({
        snapshotOverrides: { logIndex: 3, street: 'river' },
        adviceOverrides: { takenCandidate: candidate({ frequency: 0.1 }), evLossBB: 2.5 },
      }),
      decision({
        snapshotOverrides: { logIndex: 5, street: 'turn' },
        adviceOverrides: { takenCandidate: candidate({ frequency: 0.9 }), evLossBB: 0.0 },
      }),
    ];
    const summary = summarizeAnalysis(decisions);
    expect(summary.worst).toEqual({ logIndex: 3, street: 'river', evLossBB: 2.5 });
  });

  it('mistake が無ければ worst は null', () => {
    const decisions: AnalyzedDecision[] = [
      decision({ adviceOverrides: { takenCandidate: candidate({ frequency: 0.9 }) } }),
    ];
    const summary = summarizeAnalysis(decisions);
    expect(summary.worst).toBeNull();
  });
});

describe('sourceChipLabel', () => {
  it('cfr-exact は GTO解', () => {
    expect(sourceChipLabel(advice({ source: 'cfr-exact' }))).toBe('GTO解');
  });
  it('range-table 単独（rangeOrigin未指定）は レンジ表', () => {
    expect(sourceChipLabel(advice({ source: 'range-table' }))).toBe('レンジ表');
  });
  it('range-table かつ rangeOrigin=solver は GTOレンジ', () => {
    expect(sourceChipLabel(advice({ source: 'range-table', rangeOrigin: 'solver' }))).toBe('GTOレンジ');
  });
  it('presolve は GTOプリソルブ', () => {
    expect(sourceChipLabel(advice({ source: 'presolve' }))).toBe('GTOプリソルブ');
  });
  it('legacy は参考', () => {
    expect(sourceChipLabel(advice({ source: 'legacy' }))).toBe('参考');
  });
});
