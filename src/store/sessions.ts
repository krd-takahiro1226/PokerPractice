import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SessionFormat, SessionState } from '../core/game/session';
import type { GameMode } from '../core/ranges/mode';
import type { GameConfig } from '../core/game/types';
import { currentUserId } from './persistence';
import { insertSession, updateSession, fetchSessions } from './remote/sessions';

export type ActiveSession = { recordId: string; state: SessionState; savedAt: number };

export type SessionRecord = {
  id: string;
  format: SessionFormat;
  mode: GameMode;
  difficulty: GameConfig['difficulty'];
  startingStack: number;
  startedAt: number;
  endedAt: number | null;
  result: 'bust' | 'win' | 'quit' | null;
  handsPlayed: number;
  stackCurve: number[];
};

type SessionsState = {
  sessions: SessionRecord[];
  loaded: boolean;
  activeSession: ActiveSession | null;
  /** セッション開始: localStorage に即時保存。ログイン時は DB にも insert。生成した ID を返す。 */
  createSession: (
    params: Pick<SessionRecord, 'format' | 'mode' | 'difficulty' | 'startingStack'>,
  ) => Promise<string>;
  /** セッション終了: localStorage と DB を更新。 */
  finishSession: (
    id: string,
    patch: { result: 'bust' | 'win' | 'quit'; handsPlayed: number; stackCurve: number[] },
  ) => Promise<void>;
  /** DB から取得してローカルキャッシュを更新。ログイン時のみ意味あり。 */
  loadFromCloud: () => Promise<void>;
  /** ハンド間の SessionState を localStorage に即時保存（同期・local のみ）。 */
  saveActiveSession: (recordId: string, state: SessionState) => void;
  clearActiveSession: () => void;
  /** 進行中セッションを「途中終了」として確定し、活動中セッションをクリアする。 */
  discardActiveSession: () => Promise<void>;
};

const MAX_SESSIONS = 50;
const LOCAL_KEY = 'poker-trainer-sessions';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useSessions = create<SessionsState>()(
  persist(
    (set, get) => ({
      sessions: [],
      loaded: false,
      activeSession: null,

      createSession: async (params) => {
        const id = generateId();
        const record: SessionRecord = {
          id,
          ...params,
          startedAt: Date.now(),
          endedAt: null,
          result: null,
          handsPlayed: 0,
          stackCurve: [params.startingStack],
        };

        // localStorage は即時更新
        set((s) => ({
          sessions: [record, ...s.sessions].slice(0, MAX_SESSIONS),
        }));

        // ログイン中なら DB にも insert
        const uid = currentUserId();
        if (uid !== null) {
          const dbId = await insertSession(uid, record).catch(() => null);
          // DB が ID を返した場合、ローカル ID をそれに揃える
          if (dbId && dbId !== id) {
            set((s) => ({
              sessions: s.sessions.map((r) =>
                r.id === id ? { ...r, id: dbId } : r,
              ),
            }));
            return dbId;
          }
        }

        return id;
      },

      finishSession: async (id, patch) => {
        const endedAt = Date.now();
        set((s) => ({
          sessions: s.sessions.map((r) =>
            r.id === id
              ? { ...r, endedAt, ...patch }
              : r,
          ),
        }));

        const uid = currentUserId();
        if (uid !== null) {
          await updateSession(uid, id, patch).catch(() => {});
        }
      },

      loadFromCloud: async () => {
        const uid = currentUserId();
        if (uid === null) return;
        try {
          const remote = await fetchSessions(uid);
          if (remote.length > 0) {
            set({ sessions: remote, loaded: true });
          }
        } catch {
          // ネットワーク失敗はローカル state を保持
        }
      },

      saveActiveSession: (recordId, state) => {
        set((s) => ({
          activeSession: { recordId, state, savedAt: Date.now() },
          sessions: s.sessions.map((r) =>
            r.id === recordId
              ? { ...r, handsPlayed: state.handNumber, stackCurve: state.stackCurve }
              : r,
          ),
        }));
      },

      clearActiveSession: () => {
        set({ activeSession: null });
      },

      discardActiveSession: async () => {
        const active = get().activeSession;
        if (active) {
          await get().finishSession(active.recordId, {
            result: 'quit',
            handsPlayed: active.state.handNumber,
            stackCurve: active.state.stackCurve,
          });
        }
        set({ activeSession: null });
      },
    }),
    {
      name: LOCAL_KEY,
      version: 2,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as SessionsState;
        if (version < 2) {
          return { ...state, activeSession: null } as SessionsState;
        }
        return state;
      },
    },
  ),
);
