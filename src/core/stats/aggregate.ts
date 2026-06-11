import type { QuizAttempt } from '../../store/attempts';

export type Bucket = { key: string; attempts: number; correct: number };
export function accuracyOf(b: Bucket): number { return b.attempts ? b.correct / b.attempts : 0; }

export function overall(attempts: QuizAttempt[]): Bucket {
  return {
    key: 'overall',
    attempts: attempts.length,
    correct: attempts.filter((a) => a.correct).length,
  };
}

export function byDrillKind(attempts: QuizAttempt[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const a of attempts) {
    const key = a.drillKind;
    const b = map.get(key) ?? { key, attempts: 0, correct: 0 };
    b.attempts++;
    if (a.correct) b.correct++;
    map.set(key, b);
  }
  return Array.from(map.values());
}

export function byPosition(attempts: QuizAttempt[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const a of attempts) {
    if (!a.position) continue;
    const key = a.position;
    const b = map.get(key) ?? { key, attempts: 0, correct: 0 };
    b.attempts++;
    if (a.correct) b.correct++;
    map.set(key, b);
  }
  return Array.from(map.values());
}

export function byHandClass(attempts: QuizAttempt[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const a of attempts) {
    if (!a.handClass) continue;
    const key = a.handClass;
    const b = map.get(key) ?? { key, attempts: 0, correct: 0 };
    b.attempts++;
    if (a.correct) b.correct++;
    map.set(key, b);
  }
  return Array.from(map.values());
}

export function byScenario(attempts: QuizAttempt[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const a of attempts) {
    if (!a.scenarioId) continue;
    const key = a.scenarioId;
    const b = map.get(key) ?? { key, attempts: 0, correct: 0 };
    b.attempts++;
    if (a.correct) b.correct++;
    map.set(key, b);
  }
  return Array.from(map.values());
}

export function weakest(attempts: QuizAttempt[], minN: number, k: number): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const a of attempts) {
    if (!a.scenarioId) continue;
    const key = `${a.scenarioId}@${a.position ?? 'unknown'}`;
    const b = map.get(key) ?? { key, attempts: 0, correct: 0 };
    b.attempts++;
    if (a.correct) b.correct++;
    map.set(key, b);
  }
  return Array.from(map.values())
    .filter((b) => b.attempts >= minN)
    .sort((a, b) => accuracyOf(a) - accuracyOf(b))
    .slice(0, k);
}
