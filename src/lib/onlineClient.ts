// Thin typed wrapper over `supabase.functions.invoke('online-room', ...)`.
// Mirrors the wire contract of supabase/functions/online-room/index.ts (Deno, not imported here —
// that tree is outside this project's tsconfig). Keep these types in sync manually if the
// server contract changes.
import { supabase } from './supabase';
import type { PlayerActionType } from '../core/game/types';
import type { TournamentConfigInput } from '../core/online/tournament';

export type OnlineRequest =
  | { action: 'create_room'; config: TournamentConfigInput; displayName: string }
  | { action: 'join_room'; code: string; displayName: string }
  | { action: 'leave_room'; roomId: string }
  | { action: 'start_game'; roomId: string }
  | { action: 'kick_player'; roomId: string; targetUid: string }
  | {
      action: 'player_action';
      roomId: string;
      version: number;
      move: { type: PlayerActionType; amount?: number };
    }
  | { action: 'next_hand'; roomId: string }
  | { action: 'claim_timeout'; roomId: string; version: number; targetUid: string }
  | { action: 'cpu_action'; roomId: string; version: number }
  | { action: 'heartbeat'; roomId: string };

export type OnlineErrorCode =
  | 'unauthorized'
  | 'room_not_found'
  | 'room_full'
  | 'not_host'
  | 'not_your_turn'
  | 'illegal_action'
  | 'stale'
  | 'not_in_hand'
  | 'already_started'
  | 'seat_conflict'
  | 'already_left'
  | 'internal';

export type OnlineResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: OnlineErrorCode };

/** Typed error thrown by invokeOnline. `code` is 'internal' for transport/client-side failures
 *  (e.g. supabase===null, network error) as well as for server-reported 'internal' errors. */
export class OnlineClientError extends Error {
  code: OnlineErrorCode;
  constructor(code: OnlineErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'OnlineClientError';
    this.code = code;
  }
}

/**
 * Invokes the online-room edge function and normalizes the result.
 * Throws OnlineClientError on: supabase===null (guest mode), transport failure, or `{ok:false}`.
 * Resolves with `data.data` on `{ok:true}`.
 */
export async function invokeOnline<T>(body: OnlineRequest): Promise<T> {
  if (supabase === null) {
    throw new OnlineClientError('internal', 'オンライン対戦には Supabase の設定が必要です。');
  }

  const { data, error } = await supabase.functions.invoke<OnlineResponse<T>>('online-room', { body });

  if (error) {
    throw new OnlineClientError('internal', error.message ?? 'online-room request failed');
  }
  if (!data) {
    throw new OnlineClientError('internal', 'online-room returned no data');
  }
  if (!data.ok) {
    throw new OnlineClientError(data.error, `online-room error: ${data.error}`);
  }
  return data.data;
}

// One function per action for ergonomic call sites in useOnlineRoom.

export function createRoom(config: TournamentConfigInput, displayName: string) {
  return invokeOnline<{ roomId: string; code: string }>({ action: 'create_room', config, displayName });
}

export function joinRoom(code: string, displayName: string) {
  return invokeOnline<{ roomId: string; seat: number }>({ action: 'join_room', code, displayName });
}

export function leaveRoom(roomId: string) {
  return invokeOnline<Record<string, never>>({ action: 'leave_room', roomId });
}

export function startGame(roomId: string) {
  return invokeOnline<{ version: number }>({ action: 'start_game', roomId });
}

export function kickPlayer(roomId: string, targetUid: string) {
  return invokeOnline<Record<string, never>>({ action: 'kick_player', roomId, targetUid });
}

export function playerAction(
  roomId: string,
  version: number,
  move: { type: PlayerActionType; amount?: number },
) {
  return invokeOnline<{ version: number }>({ action: 'player_action', roomId, version, move });
}

export function nextHand(roomId: string) {
  return invokeOnline<{ version: number }>({ action: 'next_hand', roomId });
}

export function claimTimeout(roomId: string, version: number, targetUid: string) {
  return invokeOnline<{ version: number }>({ action: 'claim_timeout', roomId, version, targetUid });
}

export function cpuAction(roomId: string, version: number) {
  return invokeOnline<{ version: number }>({ action: 'cpu_action', roomId, version });
}

export function heartbeat(roomId: string) {
  return invokeOnline<Record<string, never>>({ action: 'heartbeat', roomId });
}
