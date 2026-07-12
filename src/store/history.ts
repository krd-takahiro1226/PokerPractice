import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GameState, HandLogEntry, HandResult, GameConfig } from '../core/game/types';
import type { Card } from '../core/cards';
import type { Position } from '../core/ranges/types';
import type { GameMode } from '../core/ranges/mode';
import { currentUserId } from './persistence';
import { insertHand } from './remote/hands';

export type SavedHand = {
  id: string;
  ts: number;
  mode: GameMode;
  difficulty: GameConfig['difficulty'];
  heroPos: Position;
  heroHole: [Card, Card];
  board: Card[];
  log: HandLogEntry[];
  result: HandResult;
  heroNet: number;
  // ---- v3 追加（すべて optional: 旧データ互換）。GTOレビューの盤面復元に使う ----
  version?: number;
  /** ハンド開始時の各席スタック(bb)。index = player.id */
  stacks?: number[];
  blinds?: { sb: number; bb: number; ante: number };
  /** BTN の player.id */
  buttonSeat?: number;
  playerCount?: number;
};

export type SavedHandV3Fields = Required<
  Pick<SavedHand, 'version' | 'stacks' | 'blinds' | 'buttonSeat' | 'playerCount'>
>;

/** ハンド終了後の GameState から v3 保存フィールドを導出する。
 *  開始スタックは総拠出会計の不変量 start = stack + committedTotal - win で厳密に復元できる
 *  （applyAction は支払い分を stack→committedTotal へ移し、resolveShowdown の refund/配当も
 *  両辺を同額ずつ動かすため）。 */
export function savedHandV3Fields(state: GameState): SavedHandV3Fields {
  const winBy = new Map<number, number>();
  for (const w of state.result?.winners ?? []) {
    winBy.set(w.playerId, (winBy.get(w.playerId) ?? 0) + w.amount);
  }
  return {
    version: 3,
    stacks: state.players.map((p) => p.stack + p.committedTotal - (winBy.get(p.id) ?? 0)),
    blinds: { sb: state.config.sb, bb: state.config.bb, ante: state.config.ante ?? 0 },
    buttonSeat: state.buttonSeat,
    playerCount: state.players.length,
  };
}

type HistoryState = {
  hands: SavedHand[];
  add: (hand: SavedHand) => void;
  clear: () => void;
};

const MAX_HANDS = 100;

export const useHistory = create<HistoryState>()(
  persist(
    (set) => ({
      hands: [],
      add: (hand) => {
        // localStorage 系統は常に更新（ゲスト時の正データ、ログイン時のローカルキャッシュ）
        set((s) => {
          const next = [hand, ...s.hands].slice(0, MAX_HANDS);
          try {
            return { hands: next };
          } catch (e) {
            if (e instanceof Error && e.name === 'QuotaExceededError') {
              return { hands: [hand, ...s.hands.slice(0, Math.floor(MAX_HANDS / 2))] };
            }
            throw e;
          }
        });
        // ログイン中なら Supabase にも非同期 insert（失敗は握りつぶす）
        const uid = currentUserId();
        if (uid !== null) {
          insertHand(uid, hand).catch(() => {
            // ネットワーク失敗はローカル state を保持したまま無視
          });
        }
      },
      clear: () => set({ hands: [] }),
    }),
    {
      name: 'poker-trainer-history',
      // v3: SavedHand に optional フィールド追加のみ（migrate は素通し）
      version: 3,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as { hands?: Record<string, unknown>[] };
        if (version < 2 && state?.hands) {
          state.hands = state.hands.map((h) => ({
            mode: 'tournament' as GameMode,
            ...h,
          }));
        }
        return state as unknown as HistoryState;
      },
    },
  ),
);
