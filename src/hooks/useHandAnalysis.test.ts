import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performAnalysis, type AnalysisDeps } from './useHandAnalysis';
import { useAnalysisStore } from '../store/analysis';
import { ANALYZER_VERSION, type AnalyzedDecision } from '../core/solver';
import type { SavedHand } from '../store/history';

function makeHand(id: string): SavedHand {
  return {
    id,
    ts: 0,
    mode: 'cash-noante',
    difficulty: 'normal',
    heroPos: 'BTN',
    heroHole: ['As', 'Kd'],
    board: [],
    log: [],
    result: { winners: [], shown: [], board: [], endedAtStreet: 'preflop' },
    heroNet: 0,
  } as SavedHand;
}

const fakeDecisions: AnalyzedDecision[] = [
  {
    snapshot: {} as AnalyzedDecision['snapshot'],
    advice: { spot: {} as AnalyzedDecision['advice']['spot'], candidates: [], takenCandidate: null, confidence: 'low', source: 'legacy' },
  },
];

describe('performAnalysis', () => {
  beforeEach(() => {
    useAnalysisStore.setState({ results: {}, order: [] });
  });

  it('cache ミス時は loading を経て runner 成功で done になり、store に保存される', async () => {
    const hand = makeHand('hand-1');
    const runner = vi.fn(async (_hand, _custom, _solveTurn, onProgress: (d: number, t: number) => void) => {
      onProgress(1, 2);
      onProgress(2, 2);
      return fakeDecisions;
    });
    const deps: AnalysisDeps = {
      getCached: (id, requireTurn) => useAnalysisStore.getState().getAnalysis(id, requireTurn),
      setCached: (id, decisions, solvedTurn) => useAnalysisStore.getState().setAnalysis(id, decisions, solvedTurn),
      runner,
    };
    const updates: string[] = [];
    await performAnalysis(hand, undefined, false, deps, (s) => updates.push(s.status));

    expect(runner).toHaveBeenCalledTimes(1);
    expect(updates[0]).toBe('loading');
    expect(updates[updates.length - 1]).toBe('done');
    expect(useAnalysisStore.getState().getAnalysis('hand-1')).toEqual({
      decisions: fakeDecisions,
      solvedTurn: false,
    });
  });

  it('runner が reject すると failed になり、error にメッセージが入る。retry で再度 runner が呼ばれる', async () => {
    const hand = makeHand('hand-2');
    const runner = vi.fn().mockRejectedValue(new Error('boom'));
    const deps: AnalysisDeps = {
      getCached: (id, requireTurn) => useAnalysisStore.getState().getAnalysis(id, requireTurn),
      setCached: (id, decisions, solvedTurn) => useAnalysisStore.getState().setAnalysis(id, decisions, solvedTurn),
      runner,
    };
    const updates: { status: string; error: string | null }[] = [];
    await performAnalysis(hand, undefined, false, deps, (s) => {
      updates.push({ status: s.status, error: s.error });
    });
    expect(updates[updates.length - 1]).toEqual({ status: 'failed', error: 'boom' });
    expect(runner).toHaveBeenCalledTimes(1);

    // retry 相当: 同じ deps で再実行
    await performAnalysis(hand, undefined, false, deps, (s) => {
      updates.push({ status: s.status, error: s.error });
    });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('store に analyzerVersion 一致のキャッシュがあれば cached になり runner は呼ばれない', async () => {
    const hand = makeHand('hand-3');
    useAnalysisStore.getState().setAnalysis('hand-3', fakeDecisions, false);
    const runner = vi.fn();
    const deps: AnalysisDeps = {
      getCached: (id, requireTurn) => useAnalysisStore.getState().getAnalysis(id, requireTurn),
      setCached: (id, decisions, solvedTurn) => useAnalysisStore.getState().setAnalysis(id, decisions, solvedTurn),
      runner,
    };
    const updates: string[] = [];
    await performAnalysis(hand, undefined, false, deps, (s) => updates.push(s.status));

    expect(runner).not.toHaveBeenCalled();
    expect(updates).toEqual(['cached']);
  });

  it('analyzerVersion が一致しないキャッシュエントリはヒットしない', async () => {
    const hand = makeHand('hand-4');
    useAnalysisStore.setState({
      results: { 'hand-4': { analyzerVersion: ANALYZER_VERSION - 1, decisions: fakeDecisions, solvedTurn: false } },
      order: ['hand-4'],
    });
    const runner = vi.fn(async () => fakeDecisions);
    const deps: AnalysisDeps = {
      getCached: (id, requireTurn) => useAnalysisStore.getState().getAnalysis(id, requireTurn),
      setCached: (id, decisions, solvedTurn) => useAnalysisStore.getState().setAnalysis(id, decisions, solvedTurn),
      runner,
    };
    const updates: string[] = [];
    await performAnalysis(hand, undefined, false, deps, (s) => updates.push(s.status));

    expect(runner).toHaveBeenCalledTimes(1);
    expect(updates[0]).toBe('loading');
    expect(updates[updates.length - 1]).toBe('done');
  });

  it('turn 済みキャッシュを solveTurn:false で開いても turnSolved はキャッシュの実績 true を反映する', async () => {
    const hand = makeHand('hand-6');
    useAnalysisStore.getState().setAnalysis('hand-6', fakeDecisions, true);
    const runner = vi.fn();
    const deps: AnalysisDeps = {
      getCached: (id, requireTurn) => useAnalysisStore.getState().getAnalysis(id, requireTurn),
      setCached: (id, decisions, solvedTurn) => useAnalysisStore.getState().setAnalysis(id, decisions, solvedTurn),
      runner,
    };
    const updates: { status: string; turnSolved: boolean }[] = [];
    await performAnalysis(hand, undefined, false, deps, (s) => updates.push({ status: s.status, turnSolved: s.turnSolved }));

    expect(runner).not.toHaveBeenCalled();
    expect(updates).toEqual([{ status: 'cached', turnSolved: true }]);
  });

  it('river のみキャッシュ済み → solveTurn:true を要求すると再実行され solvedTurn:true で保存される', async () => {
    const hand = makeHand('hand-5');
    useAnalysisStore.getState().setAnalysis('hand-5', fakeDecisions, false);
    const runner = vi.fn(async () => fakeDecisions);
    const deps: AnalysisDeps = {
      getCached: (id, requireTurn) => useAnalysisStore.getState().getAnalysis(id, requireTurn),
      setCached: (id, decisions, solvedTurn) => useAnalysisStore.getState().setAnalysis(id, decisions, solvedTurn),
      runner,
    };
    const updates: { status: string; turnSolved: boolean }[] = [];
    await performAnalysis(hand, undefined, true, deps, (s) => updates.push({ status: s.status, turnSolved: s.turnSolved }));

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(hand, undefined, true, expect.any(Function));
    expect(updates[updates.length - 1]).toEqual({ status: 'done', turnSolved: true });
    expect(useAnalysisStore.getState().results['hand-5']).toMatchObject({ solvedTurn: true });
  });
});
