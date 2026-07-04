// The single hook a later `pages/Online.tsx` will use to drive the online-versus room:
// room lifecycle (create/join/leave/start), realtime subscription (§5.4 of
// docs/ONLINE-VERSUS.md), per-action wire calls, and UI-facing derived values
// (isMyTurn/legal/deadlineMs/...). Server-authoritative: this hook never runs game logic,
// it only calls the online-room edge function and mirrors what the server publishes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useAuth } from '../store/auth';
import {
  useOnlineStore,
  getStoredRoomCode,
  storeRoomCode,
  type RoomPlayerRow,
  type RoomPhase,
  type RoomStatus,
} from '../store/online';
import {
  OnlineClientError,
  createRoom as apiCreateRoom,
  joinRoom as apiJoinRoom,
  leaveRoom as apiLeaveRoom,
  startGame as apiStartGame,
  playerAction as apiPlayerAction,
  nextHand as apiNextHand,
  claimTimeout as apiClaimTimeout,
  cpuAction as apiCpuAction,
  heartbeat as apiHeartbeat,
} from '../lib/onlineClient';
// Type-only imports from core are always fine; `legalActions`, `canContinue`, and `isCpuUid` are
// the three pure core functions this hook is explicitly permitted to call (see task brief).
import type { GameState, PlayerActionType } from '../core/game/types';
import type { Card } from '../core/cards';
import type { PublicGameState } from '../core/online/types';
import type { TournamentConfig, TournamentConfigInput, TournamentState } from '../core/online/tournament';
import { legalActions, type LegalActions } from '../core/game/engine';
import { canContinue, isCpuUid } from '../core/online/tournament';

const HEARTBEAT_INTERVAL_MS = 15_000;
const NEXT_HAND_DELAY_MS = 8_000;
const REACTION_TTL_MS = 3_000;
const LOBBY_RESYNC_INTERVAL_MS = 5_000;

// ホストのロビー離脱で部屋が cascade delete された際(ON-5)、残った参加者のロビー画面に
// 一度だけ「部屋が閉じられました」を表示するためのフラグ。sessionStorage 越しに渡すことで、
// reset() でこのフックの状態が全部消えた後でも OnlineLobby 側が拾える(storeRoomCode と同じ手法)。
const ROOM_CLOSED_NOTICE_KEY = 'poker-online-room-closed-notice';

function markRoomClosedNotice(): void {
  try {
    sessionStorage.setItem(ROOM_CLOSED_NOTICE_KEY, '1');
  } catch {
    // ignore storage errors (private browsing, quota, etc.)
  }
}

/** フラグが立っていれば消費して true を返す(一度読んだら消える)。 */
export function consumeRoomClosedNotice(): boolean {
  try {
    if (sessionStorage.getItem(ROOM_CLOSED_NOTICE_KEY) !== '1') return false;
    sessionStorage.removeItem(ROOM_CLOSED_NOTICE_KEY);
    return true;
  } catch {
    return false;
  }
}

type RoomRow = {
  id: string;
  code: string;
  host_uid: string;
  status: RoomStatus;
  config: unknown;
  created_at: string;
  updated_at: string;
};

type RoomStateRow = {
  room_id: string;
  version: number;
  hand_number: number;
  phase: RoomPhase;
  public: PublicGameState | Record<string, never>;
  tournament: TournamentState | Record<string, never>;
  action_deadline: string | null;
  updated_at: string;
};

type RoomHoleCardRow = {
  room_id: string;
  hand_number: number;
  uid: string;
  hole: [Card, Card];
  created_at: string;
};

/** Applies a `room_states` row (from initial SELECT or a postgres_changes event) to the store. */
function applyStateRow(row: RoomStateRow): void {
  const store = useOnlineStore.getState();
  const pub = row.public && Object.keys(row.public).length > 0 ? (row.public as PublicGameState) : null;
  const trn =
    row.tournament && Object.keys(row.tournament).length > 0 ? (row.tournament as TournamentState) : null;
  // 新しいハンドが始まったら前ハンドの自分の hole を必ず落とす。落とさないと、hole INSERT
  // イベントの取りこぼし時に「前のハンドのカード」を自分の手として表示し続けてしまう。
  if (row.hand_number !== store.handNumber) store.setMyHole(null);
  store.setPublicState(pub);
  store.setTournament(trn);
  store.setVersion(row.version);
  store.setPhase(row.phase);
  store.setActionDeadline(row.action_deadline);
  store.setHandNumber(row.hand_number);

  if (row.phase === 'hand_over' && pub?.result) {
    const result = pub.result;
    store.pushHandHistory({
      handNumber: row.hand_number,
      board: result.board,
      winners: result.winners.map((w) => ({
        displayName: pub.players[w.playerId]?.displayName ?? '?',
        amount: w.amount,
      })),
      shown: result.shown.map((s) => ({
        displayName: pub.players[s.playerId]?.displayName ?? '?',
        hole: s.hole,
        handName: s.handName,
      })),
      log: pub.log,
      players: pub.players.map((p, i) => ({
        playerId: i,
        displayName: p.displayName,
        pos: p.pos,
        stackAfter: p.stack,
      })),
    });
  }
}

async function refetchPlayers(roomId: string): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase
    .from('room_players')
    .select('*')
    .eq('room_id', roomId)
    .order('seat')
    .returns<RoomPlayerRow[]>();
  if (data) useOnlineStore.getState().setPlayers(data);
}

// rooms / room_states / room_players をまとめて SELECT し store に反映する。enterRoom の初期同期に
// 加え、Realtime イベント取りこぼし時の自己修復(ロビーの定期再同期・再購読直後・start_game 前後)
// からも呼ばれる。返り値は現在の hand_number(enterRoom の hole 初期取得用)。
async function syncRoomSnapshot(roomId: string): Promise<number> {
  if (!supabase) return 0;
  const [{ data: roomRow }, { data: stateRow }, { data: playersRows }] = await Promise.all([
    supabase.from('rooms').select('*').eq('id', roomId).maybeSingle<RoomRow>(),
    supabase.from('room_states').select('*').eq('room_id', roomId).maybeSingle<RoomStateRow>(),
    supabase.from('room_players').select('*').eq('room_id', roomId).order('seat').returns<RoomPlayerRow[]>(),
  ]);
  const store = useOnlineStore.getState();
  // SELECT 中に退出/リセットされていたら古い部屋の結果を書き込まない。
  if (store.roomId !== roomId) return 0;
  if (roomRow) {
    store.setRoomStatus(roomRow.status);
    store.setHostUid(roomRow.host_uid);
    store.setRoomCode(roomRow.code);
    store.setRoomConfig(roomRow.config as TournamentConfig);
  }
  // SELECT 中に Realtime でより新しい version が適用されていたら巻き戻さない。
  if (stateRow && stateRow.version >= store.version) applyStateRow(stateRow);
  if (playersRows) store.setPlayers(playersRows);
  return stateRow?.hand_number ?? 0;
}

export function useOnlineRoom() {
  const store = useOnlineStore();
  // 毎レンダーで localStorage を読み直す(マウント時固定だと「退出」直後の再レンダーで
  // クリア済みのコードを返し続け、退出した部屋への再参加バナーが出てしまう)。
  const storedRoomCode = getStoredRoomCode();
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nextHandTimerRef = useRef<{ hand: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const timeoutClaimKeyRef = useRef<string | null>(null);
  const cpuActionKeyRef = useRef<string | null>(null);
  const cpuActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disconnect = useCallback(() => {
    if (channelRef.current && supabase) {
      supabase.removeChannel(channelRef.current);
    }
    channelRef.current = null;
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (nextHandTimerRef.current) {
      clearTimeout(nextHandTimerRef.current.timer);
      nextHandTimerRef.current = null;
    }
    timeoutClaimKeyRef.current = null;
    if (cpuActionTimerRef.current) {
      clearTimeout(cpuActionTimerRef.current);
      cpuActionTimerRef.current = null;
    }
    cpuActionKeyRef.current = null;
  }, []);

  // Subscribes to the room's realtime channel, then seeds the store from one-shot SELECTs
  // (postgres_changes only delivers *future* row changes, per docs/ONLINE-VERSUS.md §5.4).
  const enterRoom = useCallback(async (roomId: string) => {
    if (!supabase) return;
    useOnlineStore.getState().setConnectionStatus('connecting');
    useOnlineStore.getState().setRoomId(roomId);

    const channel = supabase
      .channel(`room:${roomId}`, { config: { broadcast: { self: true } } })
      .on<RoomStateRow>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_states', filter: `room_id=eq.${roomId}` },
        (payload: RealtimePostgresChangesPayload<RoomStateRow>) => {
          const row = payload.new as RoomStateRow;
          if (row && typeof row.version === 'number') applyStateRow(row);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` },
        () => {
          void refetchPlayers(roomId);
        },
      )
      .on<RoomHoleCardRow>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'room_hole_cards', filter: `room_id=eq.${roomId}` },
        (payload: RealtimePostgresChangesPayload<RoomHoleCardRow>) => {
          const row = payload.new as RoomHoleCardRow;
          const s = useOnlineStore.getState();
          // RLS already restricts delivery to our own rows; the uid check is defense-in-depth.
          if (row && row.uid === s.myUid && row.hand_number === s.handNumber) {
            s.setMyHole(row.hole);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        (payload) => {
          // Supabase Realtime は DELETE イベントに filter を適用しない(公式の制約)ため、
          // 他の部屋の削除(24時間クリーンアップ等)でも届く。old の PK で自室か照合する。
          const deletedId = (payload.old as { id?: string } | undefined)?.id;
          if (deletedId !== roomId) return;
          // ホストのロビー離脱で部屋が cascade delete された(ON-5)。既に自分の leaveRoom で
          // reset 済み(roomId===null)なら何もしない(離脱した本人に二重で通知を出さないため)。
          if (useOnlineStore.getState().roomId !== roomId) return;
          markRoomClosedNotice();
          disconnect();
          storeRoomCode(null);
          useOnlineStore.getState().reset();
        },
      )
      .on('broadcast', { event: 'reaction' }, (payload) => {
        const p = payload.payload as { uid: string; emoji: string; displayName?: unknown };
        const displayName = typeof p.displayName === 'string' ? p.displayName : '?';
        const id = crypto.randomUUID();
        useOnlineStore.getState().addReaction({ id, uid: p.uid, emoji: p.emoji, displayName });
        setTimeout(() => useOnlineStore.getState().clearReaction(id), REACTION_TTL_MS);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          useOnlineStore.getState().setConnectionStatus('connected');
          // (再)購読が確立するまでの間のイベントは届かないため、確立のたびに全体を読み直す。
          void syncRoomSnapshot(roomId);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          useOnlineStore.getState().setConnectionStatus('disconnected');
        }
      });

    channelRef.current = channel;

    const handNumber = await syncRoomSnapshot(roomId);
    if (handNumber > 0) {
      const { data: holeRows } = await supabase
        .from('room_hole_cards')
        .select('*')
        .eq('room_id', roomId)
        .eq('hand_number', handNumber)
        .returns<RoomHoleCardRow[]>();
      useOnlineStore.getState().setMyHole(holeRows?.[0]?.hole ?? null);
    }
  }, []);

  const createRoom = useCallback(
    async (config: TournamentConfigInput, displayName: string) => {
      const uid = useAuth.getState().userId;
      const { roomId, code } = await apiCreateRoom(config, displayName);
      useOnlineStore.getState().setMyUid(uid);
      useOnlineStore.getState().setHostUid(uid);
      useOnlineStore.getState().setRoomCode(code);
      storeRoomCode(code);
      await enterRoom(roomId);
      return { roomId, code };
    },
    [enterRoom],
  );

  const joinRoom = useCallback(
    async (code: string, displayName: string) => {
      const uid = useAuth.getState().userId;
      const { roomId, seat } = await apiJoinRoom(code, displayName);
      useOnlineStore.getState().setMyUid(uid);
      useOnlineStore.getState().setRoomCode(code);
      storeRoomCode(code);
      await enterRoom(roomId);
      return { roomId, seat };
    },
    [enterRoom],
  );

  const leaveRoom = useCallback(async () => {
    const roomId = useOnlineStore.getState().roomId;
    disconnect();
    storeRoomCode(null);
    useOnlineStore.getState().reset();
    if (roomId) {
      try {
        await apiLeaveRoom(roomId);
      } catch {
        // best-effort: we've already left locally regardless of server ack.
      }
    }
  }, [disconnect]);

  const startGame = useCallback(async () => {
    const roomId = useOnlineStore.getState().roomId;
    if (!roomId) throw new OnlineClientError('room_not_found', 'not in a room');
    try {
      const { version } = await apiStartGame(roomId);
      useOnlineStore.getState().setVersion(version);
    } catch (e) {
      // already_started はサーバーが「lobby 以外」で一律に返すため、Realtime 取りこぼしで
      // 「開始成功済みなのにロビー画面のまま」再度押された場合もここに来る。実状態を読み直し、
      // 実際に進行中ならエラー扱いにしない(store 反映でテーブル画面へ遷移する)。
      if (e instanceof OnlineClientError && e.code === 'already_started') {
        await syncRoomSnapshot(roomId);
        if (useOnlineStore.getState().roomStatus === 'playing') return;
      }
      throw e;
    }
    // 成功時の画面遷移を Realtime の room_states イベントだけに依存させず即時同期する。
    await syncRoomSnapshot(roomId);
  }, []);

  const act = useCallback(async (move: { type: PlayerActionType; amount?: number }) => {
    const s = useOnlineStore.getState();
    if (!s.roomId) throw new OnlineClientError('room_not_found', 'not in a room');
    try {
      const { version } = await apiPlayerAction(s.roomId, s.version, move);
      useOnlineStore.getState().setVersion(version);
    } catch (e) {
      // 'stale' は realtime の次イベントでも自己修復するが、それを待たずに room_states を
      // 読み直して即座に最新化する(ON-4: ユーザーが早く再試行できるようにする)。
      if (e instanceof OnlineClientError && e.code === 'stale' && supabase) {
        const { data: stateRow } = await supabase
          .from('room_states')
          .select('*')
          .eq('room_id', s.roomId)
          .maybeSingle<RoomStateRow>();
        if (stateRow) applyStateRow(stateRow);
      }
      // 失敗自体は呼び出し元(OnlineTable)に伝えて表示させる。ここで握りつぶさない。
      throw e;
    }
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    const uid = useAuth.getState().userId;
    if (!channelRef.current || !uid) return;
    const displayName = useOnlineStore.getState().players.find((p) => p.uid === uid)?.display_name ?? '?';
    channelRef.current.send({ type: 'broadcast', event: 'reaction', payload: { uid, emoji, displayName } });
  }, []);

  const claimTimeout = useCallback(async (targetUid: string) => {
    const s = useOnlineStore.getState();
    if (!s.roomId) return;
    try {
      const { version } = await apiClaimTimeout(s.roomId, s.version, targetUid);
      useOnlineStore.getState().setVersion(version);
    } catch {
      // ignore: another client's claim probably already succeeded, or the target already acted.
    }
  }, []);

  // Heartbeat: keep room_players.last_seen fresh while we're in a room.
  const roomId = store.roomId;
  useEffect(() => {
    if (!roomId) return;
    const interval = setInterval(() => {
      apiHeartbeat(roomId).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
    heartbeatIntervalRef.current = interval;
    return () => {
      clearInterval(interval);
      heartbeatIntervalRef.current = null;
    };
  }, [roomId]);

  // ロビー中の自己修復ポーリング: 参加者一覧と開始状態は Realtime 頼みだと、購読不良や
  // イベント取りこぼし時にホスト画面へ参加者が永久に反映されない。ロビー表示中に限り
  // 低頻度で全体を再同期する(ハンド中は stale 時の読み直し等の既存機構に任せる)。
  const inLobby = store.roomStatus !== 'finished' && (store.phase === null || store.phase === 'idle');
  useEffect(() => {
    if (!roomId || !inLobby) return;
    const interval = setInterval(() => {
      void syncRoomSnapshot(roomId);
    }, LOBBY_RESYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [roomId, inLobby]);

  // Disconnect + reset on unmount (mirrors leaveRoom's cleanup).
  useEffect(() => {
    return () => {
      disconnect();
      useOnlineStore.getState().reset();
    };
  }, [disconnect]);

  // Derived values -----------------------------------------------------------------

  const publicState = store.publicState;
  const myUid = store.myUid;

  // `publicState.players[i].uid` is the source of truth for "who is seat i this hand" — the
  // per-hand engine seat order (button-relative, from tournament.setupHand) is unrelated to the
  // stable `room_players.seat` column, so isMyTurn/mySeatIndex must index into publicState.players.
  const isMyTurn = useMemo(() => {
    if (!publicState || publicState.toAct == null) return false;
    return publicState.players[publicState.toAct]?.uid === myUid;
  }, [publicState, myUid]);

  const mySeatIndex = useMemo(() => {
    if (!publicState) return null;
    const idx = publicState.players.findIndex((p) => p.uid === myUid);
    return idx >= 0 ? idx : null;
  }, [publicState, myUid]);

  const legal: LegalActions | null = useMemo(() => {
    if (!isMyTurn || mySeatIndex === null || !publicState) return null;
    const players = publicState.players.map((p, i) => (i === mySeatIndex ? { ...p, hole: store.myHole } : p));
    // legalActions only reads stack/committedStreet/currentBet/minRaise/config.bb off GameState,
    // all of which PublicGameState carries verbatim (only `deck` and other seats' `hole` are
    // omitted, neither of which legalActions touches) — so this cast is safe.
    const gameStateLike = { ...publicState, players } as unknown as GameState;
    return legalActions(gameStateLike, mySeatIndex);
  }, [isMyTurn, mySeatIndex, publicState, store.myHole]);

  const isHost = store.hostUid !== null && store.hostUid === myUid;

  // winnerUids: uid(s) of the just-finished hand's winner(s) (split pots -> multiple), derived
  // from PublicGameState.result.winners (HandResult['winners'] = {playerId, amount}[], where
  // playerId indexes publicState.players). Empty when no hand has concluded yet.
  const winnerUids = useMemo(() => {
    if (!publicState?.result) return [];
    return publicState.result.winners
      .map((w) => publicState.players[w.playerId]?.uid)
      .filter((u): u is string => Boolean(u));
  }, [publicState]);

  const phase = store.phase;
  const actionDeadline = store.actionDeadline;

  // myHole 安全網: 通常は room_hole_cards の INSERT イベントで届くが、サーバーは room_states
  // 更新の「後」に hole を insert するため、状態更新直後の SELECT は空のことがある（レース）。
  // また Realtime イベント自体の取りこぼしにも備え、hole が未着の間だけ短いリトライで再取得する。
  const myHoleMissing = store.myHole === null;
  useEffect(() => {
    const handNumber = useOnlineStore.getState().handNumber;
    if (!roomId || handNumber === 0 || phase !== 'in_hand' || !myHoleMissing) return;
    let cancelled = false;
    const fetchHole = async (attempt: number) => {
      if (cancelled || !supabase) return;
      const { data } = await supabase
        .from('room_hole_cards')
        .select('*')
        .eq('room_id', roomId)
        .eq('hand_number', handNumber)
        .returns<RoomHoleCardRow[]>();
      if (cancelled || useOnlineStore.getState().handNumber !== handNumber) return;
      const hole = data?.[0]?.hole ?? null;
      if (hole) {
        useOnlineStore.getState().setMyHole(hole);
      } else if (attempt < 3) {
        // バスト済み等でこのハンドに hole が無い場合もここに来るが、3回で打ち切るため無害。
        setTimeout(() => void fetchHole(attempt + 1), 1200);
      }
    };
    void fetchHole(0);
    return () => {
      cancelled = true;
    };
  }, [roomId, phase, myHoleMissing, store.handNumber]);

  // Deadline countdown: local UI-tick-rate state, recomputed every 250ms while in a hand.
  useEffect(() => {
    if (phase !== 'in_hand' || !actionDeadline) {
      setDeadlineMs(null);
      return;
    }
    const deadlineTime = new Date(actionDeadline).getTime();
    const tick = () => setDeadlineMs(deadlineTime - Date.now());
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [phase, actionDeadline]);

  // Auto next_hand: any client may drive this — the server makes it idempotent (first call
  // wins). Dependency list intentionally uses primitives (not the `tournament` object) so a
  // realtime tick that doesn't actually change phase/handNumber/canContinue never resets the timer.
  const handNumber = store.handNumber;
  const version = store.version;
  const canContinueNow = store.tournament ? canContinue(store.tournament) : false;
  useEffect(() => {
    if (phase !== 'hand_over' || !canContinueNow || !roomId) return;
    if (nextHandTimerRef.current?.hand === handNumber) return;
    const timer = setTimeout(() => {
      apiNextHand(roomId).catch((e) => {
        if (e instanceof OnlineClientError && (e.code === 'stale' || e.code === 'illegal_action')) return;
        // other errors: swallow too, per spec — a later UI layer can surface a connection issue.
      });
    }, NEXT_HAND_DELAY_MS);
    nextHandTimerRef.current = { hand: handNumber, timer };
    return () => {
      clearTimeout(timer);
      if (nextHandTimerRef.current?.timer === timer) nextHandTimerRef.current = null;
    };
  }, [phase, handNumber, canContinueNow, roomId]);

  // claim_timeout: fire once per (handNumber, actionDeadline) when the deadline lapses and it's
  // not our turn (if it IS our turn, we're the one late — do nothing special, just let the UI
  // show the countdown; another player will claim it).
  useEffect(() => {
    if (deadlineMs === null || deadlineMs > 0 || isMyTurn) return;
    const s = useOnlineStore.getState();
    if (!s.roomId || !s.publicState || s.publicState.toAct == null) return;
    const key = `${s.handNumber}:${s.actionDeadline ?? ''}`;
    if (timeoutClaimKeyRef.current === key) return;
    timeoutClaimKeyRef.current = key;
    const targetUid = s.publicState.players[s.publicState.toAct]?.uid;
    if (!targetUid) return;
    void claimTimeout(targetUid);
  }, [deadlineMs, isMyTurn, claimTimeout]);

  // cpu_action: when it's a CPU's turn, any client drives the server-authoritative CPU move after
  // a short delay (演出上の間). Fires once per (handNumber, version) via cpuActionKeyRef, same
  // pattern as timeoutClaimKeyRef above. Errors (stale/not_in_hand) mean another client already
  // drove this move — swallow them.
  useEffect(() => {
    if (phase !== 'in_hand' || !publicState || publicState.toAct == null || !roomId) return;
    const toActUid = publicState.players[publicState.toAct]?.uid;
    if (!toActUid || !isCpuUid(toActUid)) return;
    const key = `${handNumber}:${version}`;
    if (cpuActionKeyRef.current === key) return;
    cpuActionKeyRef.current = key;
    const timer = setTimeout(() => {
      cpuActionTimerRef.current = null;
      apiCpuAction(roomId, version)
        .then(({ version: v }) => useOnlineStore.getState().setVersion(v))
        .catch(() => {});
    }, 1200);
    cpuActionTimerRef.current = timer;
    return () => {
      // タイマー未発火のままキャンセルされたらキーも戻す。戻さないと再実行時に key ガードで
      // 弾かれてタイマーが二度と予約されず、CPU 手番が claim_timeout(30秒)まで止まる
      // (StrictMode の effect 二重実行や、同 version での publicState 再適用で起きる)。
      if (cpuActionTimerRef.current === timer) {
        clearTimeout(timer);
        cpuActionTimerRef.current = null;
        cpuActionKeyRef.current = null;
      }
    };
  }, [phase, publicState, handNumber, version, roomId]);

  return {
    // store snapshot
    roomId: store.roomId,
    roomCode: store.roomCode,
    roomStatus: store.roomStatus,
    hostUid: store.hostUid,
    players: store.players,
    publicState: store.publicState,
    tournament: store.tournament,
    phase: store.phase,
    version: store.version,
    actionDeadline: store.actionDeadline,
    handNumber: store.handNumber,
    roomConfig: store.roomConfig,
    myHole: store.myHole,
    myUid: store.myUid,
    connectionStatus: store.connectionStatus,
    reactions: store.reactions,
    clearReaction: store.clearReaction,
    handHistory: store.handHistory,
    storedRoomCode,

    // actions
    createRoom,
    joinRoom,
    leaveRoom,
    startGame,
    act,
    sendReaction,
    claimTimeout,

    // derived
    isMyTurn,
    mySeatIndex,
    legal,
    isHost,
    deadlineMs,
    winnerUids,
  };
}
