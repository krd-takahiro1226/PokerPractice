import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type DrillStats = {
  attempts: number;
  correct: number;
  streak: number;
  bestStreak: number;
};

const emptyStats = (): DrillStats => ({ attempts: 0, correct: 0, streak: 0, bestStreak: 0 });

type ScenarioStat = { attempts: number; correct: number };

type ProgressState = {
  range: DrillStats;
  potOdds: DrillStats;
  quiz: DrillStats;
  reqEquity: DrillStats;
  mdf: DrillStats;
  cbet: DrillStats;
  byScenario: Record<string, ScenarioStat>;
  recordRange: (scenarioId: string, correct: boolean) => void;
  recordPotOdds: (correct: boolean) => void;
  recordQuiz: (correct: boolean) => void;
  recordReqEquity: (correct: boolean) => void;
  recordMdf: (correct: boolean) => void;
  recordCbet: (correct: boolean) => void;
  reset: () => void;
};

function bump(stats: DrillStats, correct: boolean): DrillStats {
  const streak = correct ? stats.streak + 1 : 0;
  return {
    attempts: stats.attempts + 1,
    correct: stats.correct + (correct ? 1 : 0),
    streak,
    bestStreak: Math.max(stats.bestStreak, streak),
  };
}

export const useProgress = create<ProgressState>()(
  persist(
    (set) => ({
      range: emptyStats(),
      potOdds: emptyStats(),
      quiz: emptyStats(),
      reqEquity: emptyStats(),
      mdf: emptyStats(),
      cbet: emptyStats(),
      byScenario: {},
      recordRange: (scenarioId, correct) =>
        set((s) => {
          const prev = s.byScenario[scenarioId] ?? { attempts: 0, correct: 0 };
          return {
            range: bump(s.range, correct),
            byScenario: {
              ...s.byScenario,
              [scenarioId]: {
                attempts: prev.attempts + 1,
                correct: prev.correct + (correct ? 1 : 0),
              },
            },
          };
        }),
      recordPotOdds: (correct) => set((s) => ({ potOdds: bump(s.potOdds, correct) })),
      recordQuiz: (correct) => set((s) => ({ quiz: bump(s.quiz, correct) })),
      recordReqEquity: (correct) => set((s) => ({ reqEquity: bump(s.reqEquity, correct) })),
      recordMdf: (correct) => set((s) => ({ mdf: bump(s.mdf, correct) })),
      recordCbet: (correct) => set((s) => ({ cbet: bump(s.cbet, correct) })),
      reset: () =>
        set({
          range: emptyStats(),
          potOdds: emptyStats(),
          quiz: emptyStats(),
          reqEquity: emptyStats(),
          mdf: emptyStats(),
          cbet: emptyStats(),
          byScenario: {},
        }),
    }),
    { name: 'poker-trainer-progress' },
  ),
);

export function accuracy(stats: DrillStats): number {
  return stats.attempts === 0 ? 0 : stats.correct / stats.attempts;
}
