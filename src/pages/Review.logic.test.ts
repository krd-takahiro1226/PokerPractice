import { describe, it, expect } from 'vitest';
import { problemKeyOf, byTsDesc, dedupeByProblemKey } from './Review';
import type { QuizAttempt } from '../store/attempts';

function attempt(overrides: Partial<QuizAttempt> & Pick<QuizAttempt, 'id' | 'ts'>): QuizAttempt {
  return {
    drillKind: 'quiz',
    expected: 'raise',
    answered: 'raise',
    correct: true,
    ...overrides,
  };
}

describe('dedupeByProblemKey', () => {
  it('同じ scenarioId+handClass を持つ複数回の attempt を最新の ts のものだけに集約する', () => {
    const older = attempt({ id: 'a1', ts: 100, scenarioId: 'BTN-open', handClass: 'AKs' });
    const newer = attempt({ id: 'a2', ts: 200, scenarioId: 'BTN-open', handClass: 'AKs' });
    const result = dedupeByProblemKey([older, newer]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a2');
  });

  it('異なるキーを持つ attempt は全て結果に残る', () => {
    const a = attempt({ id: 'a1', ts: 100, scenarioId: 'BTN-open', handClass: 'AKs' });
    const b = attempt({ id: 'a2', ts: 200, scenarioId: 'CO-open', handClass: 'QQ' });
    const c = attempt({ id: 'a3', ts: 300, drillKind: 'potOdds' });

    const result = dedupeByProblemKey([a, b, c]);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id).sort()).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('byTsDesc', () => {
  it('既に降順の配列を降順のまま保つ', () => {
    const list = [
      attempt({ id: 'a1', ts: 300 }),
      attempt({ id: 'a2', ts: 200 }),
      attempt({ id: 'a3', ts: 100 }),
    ];

    const sorted = [...list].sort(byTsDesc);

    expect(sorted.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('昇順の配列を降順に並べ替える', () => {
    const list = [
      attempt({ id: 'a1', ts: 100 }),
      attempt({ id: 'a2', ts: 200 }),
      attempt({ id: 'a3', ts: 300 }),
    ];

    const sorted = [...list].sort(byTsDesc);

    expect(sorted.map((a) => a.id)).toEqual(['a3', 'a2', 'a1']);
  });
});

describe('problemKeyOf', () => {
  it('scenarioId と handClass の両方があればそれを結合したキーを返す', () => {
    expect(problemKeyOf(attempt({ id: 'a1', ts: 1, scenarioId: 'BTN-open', handClass: 'AKs' }))).toBe(
      'BTN-open:AKs',
    );
  });

  it('scenarioId のみの場合はそれ単体を返す', () => {
    expect(problemKeyOf(attempt({ id: 'a1', ts: 1, scenarioId: 'BTN-open' }))).toBe('BTN-open');
  });

  it('scenarioId が無い場合は drillKind:ts を返す', () => {
    expect(problemKeyOf(attempt({ id: 'a1', ts: 42, drillKind: 'mdf' }))).toBe('mdf:42');
  });
});
