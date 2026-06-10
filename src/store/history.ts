import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HandLogEntry, HandResult, GameConfig } from '../core/game/types';
import type { Card } from '../core/cards';
import type { Position } from '../core/ranges/types';

export type SavedHand = {
  id: string;
  ts: number;
  difficulty: GameConfig['difficulty'];
  heroPos: Position;
  heroHole: [Card, Card];
  board: Card[];
  log: HandLogEntry[];
  result: HandResult;
  heroNet: number;
};

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
      add: (hand) =>
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
        }),
      clear: () => set({ hands: [] }),
    }),
    {
      name: 'poker-trainer-history',
      version: 1,
    },
  ),
);
