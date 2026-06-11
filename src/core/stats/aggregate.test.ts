import { describe, it, expect } from 'vitest';
import type { QuizAttempt } from '../../store/attempts';
import { overall, byDrillKind, byPosition, byHandClass, weakest, accuracyOf } from './aggregate';

const attempts: QuizAttempt[] = [
  { id: '1', ts: 1, drillKind: 'range', scenarioId: 'RFI_UTG', position: 'UTG', handClass: 'AKs', expected: 'raise', answered: 'raise', correct: true },
  { id: '2', ts: 2, drillKind: 'range', scenarioId: 'RFI_UTG', position: 'UTG', handClass: 'T9o', expected: 'fold', answered: 'raise', correct: false },
  { id: '3', ts: 3, drillKind: 'quiz', scenarioId: 'quiz-1', expected: 'raise', answered: 'raise', correct: true },
  { id: '4', ts: 4, drillKind: 'potOdds', expected: 'call', answered: 'fold', correct: false },
  { id: '5', ts: 5, drillKind: 'range', scenarioId: 'RFI_HJ', position: 'HJ', handClass: 'T9s', expected: 'raise', answered: 'fold', correct: false },
];

describe('overall', () => {
  it('counts all attempts and correct', () => {
    const b = overall(attempts);
    expect(b.attempts).toBe(5);
    expect(b.correct).toBe(2);
    expect(accuracyOf(b)).toBeCloseTo(0.4);
  });
});

describe('byDrillKind', () => {
  it('groups by drill kind', () => {
    const buckets = byDrillKind(attempts);
    const range = buckets.find((b) => b.key === 'range')!;
    expect(range.attempts).toBe(3);
    expect(range.correct).toBe(1);
    const quiz = buckets.find((b) => b.key === 'quiz')!;
    expect(quiz.attempts).toBe(1);
    expect(quiz.correct).toBe(1);
  });
});

describe('byPosition', () => {
  it('groups by position, ignores missing', () => {
    const buckets = byPosition(attempts);
    const utg = buckets.find((b) => b.key === 'UTG')!;
    expect(utg.attempts).toBe(2);
    expect(utg.correct).toBe(1);
    const hj = buckets.find((b) => b.key === 'HJ')!;
    expect(hj.attempts).toBe(1);
  });
});

describe('byHandClass', () => {
  it('groups by hand class, ignores missing', () => {
    const buckets = byHandClass(attempts);
    const aks = buckets.find((b) => b.key === 'AKs')!;
    expect(aks.attempts).toBe(1);
    expect(aks.correct).toBe(1);
  });
});

describe('weakest', () => {
  it('filters by minN and returns ascending by accuracy', () => {
    const result = weakest(attempts, 1, 5);
    expect(result[0].key).toContain('RFI_HJ');
    expect(accuracyOf(result[0])).toBeCloseTo(0);
  });

  it('minN filter excludes buckets below threshold', () => {
    const result = weakest(attempts, 2, 5);
    expect(result.length).toBe(1);
    expect(result[0].key).toBe('RFI_UTG@UTG');
  });
});
