import { create } from 'zustand';
import { localPort, currentUserId } from './persistence';
import { insertAttempts, fetchAttempts } from './remote/attempts';

export type DrillKind = 'range' | 'quiz' | 'potOdds' | 'reqEquity' | 'mdf' | 'cbet' | 'perceived';

export type QuizAttempt = {
  id: string;
  ts: number;
  drillKind: DrillKind;
  scenarioId?: string;
  position?: string;
  handClass?: string;
  expected: string;
  answered: string;
  correct: boolean;
  payload?: Record<string, unknown>;
};

const STORAGE_KEY = 'poker-trainer-attempts';
const MAX_LOCAL = 2000;

type AttemptsState = {
  attempts: QuizAttempt[];
  loaded: boolean;
  record: (a: Omit<QuizAttempt, 'id' | 'ts'>) => void;
  load: () => Promise<void>;
};

export const useAttempts = create<AttemptsState>()((set, get) => ({
  attempts: [],
  loaded: false,

  record: (a) => {
    const attempt: QuizAttempt = {
      ...a,
      id: crypto.randomUUID(),
      ts: Date.now(),
    };
    set((s) => {
      let next = [...s.attempts, attempt];
      if (next.length > MAX_LOCAL) next = next.slice(next.length - MAX_LOCAL);
      return { attempts: next };
    });
    const uid = currentUserId();
    if (uid) {
      insertAttempts(uid, [attempt]).catch(() => {});
    } else {
      // read-modify-write で port.load() を経由すると連続呼び出しで古い内容が後勝ちしうるため、
      // set() 済みの最新 in-memory state をそのまま保存する。
      const port = localPort<QuizAttempt[]>(STORAGE_KEY, []);
      port.save(get().attempts).catch(() => {});
    }
  },

  load: async () => {
    const uid = currentUserId();
    let loaded: QuizAttempt[] = [];
    if (uid) {
      loaded = await fetchAttempts(uid, 2000);
    } else {
      const port = localPort<QuizAttempt[]>(STORAGE_KEY, []);
      loaded = await port.load();
    }
    set({ attempts: loaded, loaded: true });
  },
}));
