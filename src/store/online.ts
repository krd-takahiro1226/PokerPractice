// Volatile (non-persisted) store for the current online-versus room.
// Intentionally NOT wrapped with zustand's persist middleware — a page reload always
// starts guest-side state fresh; only the room code itself is convenience-cached in
// sessionStorage (see getStoredRoomCode/storeRoomCode below) so a refresh can offer
// "rejoin room XXXXXX" without re-typing it.
import { create } from 'zustand';
import type { Card } from '../core/cards';
import type { PublicGameState } from '../core/online/types';
import type { TournamentState } from '../core/online/tournament';

export type RoomStatus = 'lobby' | 'playing' | 'finished';
export type RoomPhase = 'idle' | 'in_hand' | 'hand_over' | 'finished';
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

/** Matches supabase `room_players` columns (see docs/ONLINE-VERSUS.md §4). */
export type RoomPlayerRow = {
  room_id: string;
  uid: string;
  seat: number;
  display_name: string;
  connected: boolean;
  last_seen: string; // ISO timestamp
  stack: number;
  status: 'playing' | 'busted' | 'left';
  finish_rank: number | null;
  joined_at: string; // ISO timestamp
};

export type ReactionEvent = { id: string; uid: string; emoji: string };

type OnlineStoreState = {
  roomId: string | null;
  roomCode: string | null;
  roomStatus: RoomStatus | null;
  hostUid: string | null;

  players: RoomPlayerRow[];
  publicState: PublicGameState | null;
  tournament: TournamentState | null;
  phase: RoomPhase | null;
  version: number;
  actionDeadline: string | null;
  handNumber: number;

  myHole: [Card, Card] | null;
  myUid: string | null;
  connectionStatus: ConnectionStatus;

  reactions: ReactionEvent[];

  setRoomId: (roomId: string | null) => void;
  setRoomCode: (roomCode: string | null) => void;
  setRoomStatus: (roomStatus: RoomStatus | null) => void;
  setHostUid: (hostUid: string | null) => void;
  setPlayers: (players: RoomPlayerRow[]) => void;
  setPublicState: (publicState: PublicGameState | null) => void;
  setTournament: (tournament: TournamentState | null) => void;
  setPhase: (phase: RoomPhase | null) => void;
  setVersion: (version: number) => void;
  setActionDeadline: (actionDeadline: string | null) => void;
  setHandNumber: (handNumber: number) => void;
  setMyHole: (myHole: [Card, Card] | null) => void;
  setMyUid: (myUid: string | null) => void;
  setConnectionStatus: (connectionStatus: ConnectionStatus) => void;
  addReaction: (reaction: ReactionEvent) => void;
  clearReaction: (id: string) => void;
  reset: () => void;
};

const initialState = {
  roomId: null,
  roomCode: null,
  roomStatus: null,
  hostUid: null,

  players: [],
  publicState: null,
  tournament: null,
  phase: null,
  version: 0,
  actionDeadline: null,
  handNumber: 0,

  myHole: null,
  myUid: null,
  connectionStatus: 'disconnected' as ConnectionStatus,

  reactions: [],
} satisfies Partial<OnlineStoreState>;

export const useOnlineStore = create<OnlineStoreState>()((set) => ({
  ...initialState,

  setRoomId: (roomId) => set({ roomId }),
  setRoomCode: (roomCode) => set({ roomCode }),
  setRoomStatus: (roomStatus) => set({ roomStatus }),
  setHostUid: (hostUid) => set({ hostUid }),
  setPlayers: (players) => set({ players }),
  setPublicState: (publicState) => set({ publicState }),
  setTournament: (tournament) => set({ tournament }),
  setPhase: (phase) => set({ phase }),
  setVersion: (version) => set({ version }),
  setActionDeadline: (actionDeadline) => set({ actionDeadline }),
  setHandNumber: (handNumber) => set({ handNumber }),
  setMyHole: (myHole) => set({ myHole }),
  setMyUid: (myUid) => set({ myUid }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  addReaction: (reaction) => set((s) => ({ reactions: [...s.reactions, reaction] })),
  clearReaction: (id) => set((s) => ({ reactions: s.reactions.filter((r) => r.id !== id) })),
  reset: () => set({ ...initialState }),
}));

// sessionStorage helpers kept as plain functions (not store actions) so the hook explicitly
// decides when to read/write them (e.g. only on successful create/join, and cleared on leave).
const ROOM_CODE_STORAGE_KEY = 'poker-online-room-code';

export function getStoredRoomCode(): string | null {
  try {
    return sessionStorage.getItem(ROOM_CODE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeRoomCode(code: string | null): void {
  try {
    if (code === null) {
      sessionStorage.removeItem(ROOM_CODE_STORAGE_KEY);
    } else {
      sessionStorage.setItem(ROOM_CODE_STORAGE_KEY, code);
    }
  } catch {
    // ignore storage errors (private browsing, quota, etc.)
  }
}
