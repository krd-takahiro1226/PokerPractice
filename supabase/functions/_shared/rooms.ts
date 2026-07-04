// online-room Edge Function のビジネスロジック本体。
// service-role SupabaseClient を受け取って呼ぶ前提（RLS をバイパスして書き込む）。
// ブラウザ/src 側には持ち込まない（Deno 専用、_shared/core は Deno-safe な生成コピー）。
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { startHand, applyAction, legalActions } from './core/game/engine.ts';
import type { GameConfig, GameState, PlayerActionType } from './core/game/types.ts';
import { DEFAULT_TOURNAMENT_LEVELS, DEFAULT_HANDS_PER_LEVEL } from './core/game/session.ts';
import {
  startTournament,
  setupHand,
  applyHandResult,
  markLeft,
  markLeavingDuringHand,
  canContinue,
  addLatePlayer,
} from './core/online/tournament.ts';
import type { TournamentConfig, TournamentConfigInput, TournamentState } from './core/online/tournament.ts';
import { toPublicState } from './core/online/publicState.ts';
import { progressToActionable } from './engine-driver.ts';
import { cryptoRng } from './crypto-rng.ts';
import { isValidBetAmount, resolveLeaveDuringHand } from './roomsLogic.ts';

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
  | 'internal';

export class OnlineError extends Error {
  constructor(public code: OnlineErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'OnlineError';
  }
}

// room_engine.state の実体。design doc の prose は「bare GameState」と読めるが、
// tournament を挟まないとハンド間でスタック/順位/レベルを持ち越せないため実際はこの形。
type EngineState = { tournament: TournamentState; hand: GameState | null };

function dbError(error: { message: string } | null): void {
  if (error) throw new OnlineError('internal', error.message);
}

/**
 * next_hand / claim_timeout はルームメンバーシップを検証していなかった(ON-7)。
 * 認証済みなら roomId(UUID)を知っている第三者でも呼べてしまう認可漏れを塞ぐ。
 */
async function assertRoomMember(db: SupabaseClient, roomId: string, uid: string): Promise<void> {
  const { data, error } = await db
    .from('room_players')
    .select('uid')
    .eq('room_id', roomId)
    .eq('uid', uid)
    .maybeSingle();
  dbError(error);
  if (!data) throw new OnlineError('unauthorized');
}

// ============================================================
// create_room
// ============================================================

const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 0/O/1/I/L を除外

function randomRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

async function generateUniqueRoomCode(db: SupabaseClient): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomRoomCode();
    const { data, error } = await db.from('rooms').select('id').eq('code', code).maybeSingle();
    dbError(error);
    if (!data) return code;
  }
  throw new OnlineError('internal', 'failed to generate room code');
}

function buildTournamentConfig(input: TournamentConfigInput): TournamentConfig {
  return {
    startingStack:
      input.startingStack != null ? Math.max(2, Math.min(input.startingStack, 100000)) : 100,
    blindLevels:
      input.blindLevels && input.blindLevels.length > 0 ? input.blindLevels : DEFAULT_TOURNAMENT_LEVELS,
    handsPerLevel:
      input.handsPerLevel != null ? Math.max(1, Math.floor(input.handsPerLevel)) : DEFAULT_HANDS_PER_LEVEL,
    difficulty: input.difficulty ?? 'normal',
  };
}

export async function createRoom(
  db: SupabaseClient,
  uid: string,
  config: TournamentConfigInput,
  displayName: string,
): Promise<{ roomId: string; code: string }> {
  const builtConfig = buildTournamentConfig(config ?? {});

  // ベストエフォートで24時間以上前の放置部屋を掃除する。失敗しても部屋作成は続行する。
  // status を lobby/finished に限定し、進行中(playing)の対戦を誤って削除しない(ON-6)。
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await db.from('rooms').delete().lt('created_at', cutoff).in('status', ['lobby', 'finished']);
  } catch {
    // best effort — a stuck cleanup must never block room creation.
  }

  const code = await generateUniqueRoomCode(db);

  const { data: room, error: roomErr } = await db
    .from('rooms')
    .insert({ host_uid: uid, code, status: 'lobby', config: builtConfig })
    .select()
    .single();
  dbError(roomErr);

  const { error: playerErr } = await db.from('room_players').insert({
    room_id: room.id,
    uid,
    seat: 0,
    display_name: displayName || 'Host',
    connected: true,
    stack: 0,
    status: 'playing',
  });
  dbError(playerErr);

  const { error: stateErr } = await db.from('room_states').insert({
    room_id: room.id,
    version: 0,
    hand_number: 0,
    phase: 'idle',
    public: {},
    action_deadline: null,
  });
  dbError(stateErr);

  return { roomId: room.id, code: room.code };
}

// ============================================================
// join_room
// ============================================================

// postgres の unique_violation (23505)。座席 select と insert の間の TOCTOU 競合検出用(ON-8)。
function isUniqueViolation(error: { code?: string; message: string } | null): boolean {
  return !!error && (error.code === '23505' || /duplicate key/i.test(error.message));
}

async function pickOpenSeat(db: SupabaseClient, roomId: string): Promise<number> {
  const { data: players, error: playersErr } = await db
    .from('room_players')
    .select('seat')
    .eq('room_id', roomId);
  dbError(playersErr);

  const used = new Set<number>((players ?? []).map((p: { seat: number }) => p.seat));
  if (used.size >= 6) throw new OnlineError('room_full');

  let seat = 0;
  while (used.has(seat)) seat++;
  return seat;
}

async function joinLobbyRoom(
  db: SupabaseClient,
  room: { id: string },
  uid: string,
  displayName: string,
): Promise<{ roomId: string; seat: number }> {
  const MAX_RETRIES = 1;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const seat = await pickOpenSeat(db, room.id);

    const { error: insertErr } = await db.from('room_players').insert({
      room_id: room.id,
      uid,
      seat,
      display_name: displayName,
      connected: true,
      stack: 0,
      status: 'playing',
    });
    if (!insertErr) return { roomId: room.id, seat };
    if (isUniqueViolation(insertErr)) {
      // 同時参加で座席が埋まった: リトライ枠が残っていれば座席を選び直す。
      if (attempt < MAX_RETRIES) continue;
      throw new OnlineError('seat_conflict');
    }
    dbError(insertErr);
  }
  throw new OnlineError('seat_conflict');
}

/**
 * ゲーム進行中の部屋への途中参加(docs/ONLINE-VERSUS.md 途中参加節)。
 * 新規プレイヤーは初期スタックを持ち、addLatePlayer で tournament.players に加えるだけで
 * 次の setupHand から自動的に配牌される。進行中ハンドの座席(room_engine.seat_uids)は
 * 変更しない。room_engine は楽観ロック更新で、version 競合時は最大2回まで読み直してリトライする。
 */
async function joinPlayingRoom(
  db: SupabaseClient,
  room: { id: string },
  uid: string,
  displayName: string,
): Promise<{ roomId: string; seat: number }> {
  const { data: engineRow, error: engineErr } = await db
    .from('room_engine')
    .select('*')
    .eq('room_id', room.id)
    .maybeSingle();
  dbError(engineErr);
  if (!engineRow) throw new OnlineError('already_started');

  const { tournament }: EngineState = engineRow.state;
  if (tournament.status !== 'playing') throw new OnlineError('already_started');

  // 座席 select と insert の間の TOCTOU 競合(ON-8): 一意制約違反時に1回だけ座席を選び直す。
  const SEAT_MAX_RETRIES = 1;
  let seat = -1;
  for (let attempt = 0; attempt <= SEAT_MAX_RETRIES; attempt++) {
    seat = await pickOpenSeat(db, room.id);

    const { error: insertErr } = await db.from('room_players').insert({
      room_id: room.id,
      uid,
      seat,
      display_name: displayName,
      connected: true,
      stack: tournament.config.startingStack,
      status: 'playing',
    });
    if (!insertErr) break;
    if (isUniqueViolation(insertErr)) {
      if (attempt < SEAT_MAX_RETRIES) continue;
      throw new OnlineError('seat_conflict');
    }
    dbError(insertErr);
  }

  const entry = { uid, displayName, seat };

  try {
    const MAX_RETRIES = 2;
    let currentEngineRow = engineRow;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const { tournament: currentTournament, hand: currentHand }: EngineState = currentEngineRow.state;
      // リトライの読み直しでトーナメントが終わっていたらここで打ち切る。addLatePlayer は
      // no-op で「成功」してしまい、tournament に居ない参加者を作ってしまうため。
      if (currentTournament.status !== 'playing') throw new OnlineError('already_started');
      const newTournament = addLatePlayer(currentTournament, entry);
      const newVersion = currentEngineRow.version + 1;

      const { data: updated, error: updateErr } = await db
        .from('room_engine')
        .update({
          version: newVersion,
          state: { tournament: newTournament, hand: currentHand },
          updated_at: new Date().toISOString(),
        })
        .eq('room_id', room.id)
        .eq('version', currentEngineRow.version)
        .select();
      dbError(updateErr);

      if (updated && updated.length > 0) {
        // phase / public / action_deadline / hand_number は据え置き(進行中ハンドの表示を壊さないため)。
        // これにより並行中の player_action が version 不一致で 'stale' になり得るが、クライアントは
        // realtime で自己修復する設計(useOnlineRoom.ts の act コメント参照)なので許容する。
        const { error: statesErr } = await db
          .from('room_states')
          .update({ version: newVersion, tournament: newTournament, updated_at: new Date().toISOString() })
          .eq('room_id', room.id);
        dbError(statesErr);

        return { roomId: room.id, seat };
      }

      if (attempt === MAX_RETRIES) break;

      const { data: refetched, error: refetchErr } = await db
        .from('room_engine')
        .select('*')
        .eq('room_id', room.id)
        .maybeSingle();
      dbError(refetchErr);
      if (!refetched) throw new OnlineError('stale');
      currentEngineRow = refetched;
    }

    throw new OnlineError('stale');
  } catch (e) {
    // tournament への追加が確定しなかった場合、insert 済みの room_players 行を残さない。
    // 残すと次回 join_room が「再接続」扱いで成功し、tournament に居ないまま入室できてしまう。
    await db.from('room_players').delete().eq('room_id', room.id).eq('uid', uid);
    throw e;
  }
}

export async function joinRoom(
  db: SupabaseClient,
  uid: string,
  code: string,
  displayName: string,
): Promise<{ roomId: string; seat: number }> {
  const { data: room, error: roomErr } = await db
    .from('rooms')
    .select('*')
    .eq('code', (code ?? '').trim().toUpperCase())
    .maybeSingle();
  dbError(roomErr);
  if (!room) throw new OnlineError('room_not_found');

  const { data: existing, error: existingErr } = await db
    .from('room_players')
    .select('seat')
    .eq('room_id', room.id)
    .eq('uid', uid)
    .maybeSingle();
  dbError(existingErr);
  // 再接続（既に着席済み）は部屋の状態に関わらず常に成功させる。
  if (existing) return { roomId: room.id, seat: existing.seat };

  if (room.status === 'lobby') return joinLobbyRoom(db, room, uid, displayName);
  if (room.status === 'playing') return joinPlayingRoom(db, room, uid, displayName);
  throw new OnlineError('already_started'); // finished
}

// ============================================================
// leave_room
// ============================================================

export async function leaveRoom(db: SupabaseClient, uid: string, roomId: string): Promise<Record<string, never>> {
  const { data: room, error: roomErr } = await db.from('rooms').select('*').eq('id', roomId).maybeSingle();
  dbError(roomErr);
  if (!room) return {};

  const { data: playerRow, error: playerErr } = await db
    .from('room_players')
    .select('*')
    .eq('room_id', roomId)
    .eq('uid', uid)
    .maybeSingle();
  dbError(playerErr);
  if (!playerRow) return {};

  if (room.status === 'lobby') {
    if (room.host_uid === uid) {
      // ホストがロビー中に離脱 → 部屋を畳む（cascade で players/states/engine/hole も消える, §13.3）。
      const { error } = await db.from('rooms').delete().eq('id', roomId);
      dbError(error);
    } else {
      const { error } = await db.from('room_players').delete().eq('room_id', roomId).eq('uid', uid);
      dbError(error);
    }
    return {};
  }

  // room.status === 'playing' | 'finished': ゲーム中/終了後の離脱（§13.3）。
  const { data: engineRow, error: engineErr } = await db
    .from('room_engine')
    .select('*')
    .eq('room_id', roomId)
    .maybeSingle();
  dbError(engineErr);

  if (!engineRow) {
    // 通常は起こらないが防御的に: player_players だけ left にして終わる。
    const { error } = await db
      .from('room_players')
      .update({ status: 'left', connected: false })
      .eq('room_id', roomId)
      .eq('uid', uid);
    dbError(error);
    return {};
  }

  const { tournament, hand }: EngineState = engineRow.state;
  const seatUids: string[] = engineRow.seat_uids;

  // ハンド中の離脱は手番かどうかに関わらず engine 席を処理する(ON-2): active なら強制 fold、
  // allin はハンド確定まで順位/stack の確定を保留する(pendingLeave)。詳細は roomsLogic.ts 参照。
  const { hand: foldedHand, pendingLeave } = resolveLeaveDuringHand(hand, seatUids, uid);
  const currentHand = foldedHand ? progressToActionable(foldedHand) : null;

  const newTournament = pendingLeave ? markLeavingDuringHand(tournament, uid) : markLeft(tournament, uid);

  await persistHandTransition(db, roomId, newTournament, currentHand, seatUids, engineRow.version);

  const finalPlayer = newTournament.players.find((p) => p.uid === uid);
  // pendingLeave 中は tournament 側がまだ 'playing' のまま(結果未確定)なので room_players の
  // status/stack/finish_rank は persistHandTransition の同期ループに委ね、ここでは connected だけ落とす。
  const { error: updatePlayerErr } = await db
    .from('room_players')
    .update(
      pendingLeave
        ? { connected: false }
        : { status: 'left', connected: false, stack: 0, finish_rank: finalPlayer?.finishRank ?? null },
    )
    .eq('room_id', roomId)
    .eq('uid', uid);
  dbError(updatePlayerErr);

  if (newTournament.status === 'finished') {
    const { error } = await db.from('rooms').update({ status: 'finished' }).eq('id', roomId);
    dbError(error);
  }

  return {};
}

// ============================================================
// start_game
// ============================================================

export async function startGame(db: SupabaseClient, uid: string, roomId: string): Promise<{ version: number }> {
  const { data: room, error: roomErr } = await db.from('rooms').select('*').eq('id', roomId).maybeSingle();
  dbError(roomErr);
  if (!room) throw new OnlineError('room_not_found');
  if (room.host_uid !== uid) throw new OnlineError('not_host');
  if (room.status !== 'lobby') throw new OnlineError('already_started');

  const { data: players, error: playersErr } = await db
    .from('room_players')
    .select('*')
    .eq('room_id', roomId)
    .order('seat', { ascending: true });
  dbError(playersErr);

  // OnlineErrorCode に「人数不足」専用コードが無いため illegal_action を流用する。
  if (!players || players.length < 2) {
    throw new OnlineError('illegal_action', 'need at least 2 players');
  }

  const seats = players.map((p: { uid: string; display_name: string; seat: number }) => ({
    uid: p.uid,
    displayName: p.display_name,
    seat: p.seat,
  }));

  const tournament = startTournament(seats, room.config as TournamentConfig);
  const setup = setupHand(tournament);
  const config: GameConfig = { ...setup.config, rng: cryptoRng() };
  const hand = startHand(null, config, setup.seatStacks);

  const { version } = await persistNewHand(db, roomId, tournament, hand, setup.uids, null);

  const { error: roomUpdateErr } = await db.from('rooms').update({ status: 'playing' }).eq('id', roomId);
  dbError(roomUpdateErr);

  return { version };
}

// ============================================================
// player_action
// ============================================================

export async function playerAction(
  db: SupabaseClient,
  uid: string,
  roomId: string,
  expectedVersion: number,
  move: { type: PlayerActionType; amount?: number },
): Promise<{ version: number }> {
  const { data: engineRow, error: engineErr } = await db
    .from('room_engine')
    .select('*')
    .eq('room_id', roomId)
    .maybeSingle();
  dbError(engineErr);
  if (!engineRow) throw new OnlineError('not_in_hand');
  if (engineRow.version !== expectedVersion) throw new OnlineError('stale');

  const { tournament, hand }: EngineState = engineRow.state;
  if (hand === null) throw new OnlineError('not_in_hand');

  const seatUids: string[] = engineRow.seat_uids;
  const seatIndex = seatUids.indexOf(uid);
  if (seatIndex === -1) throw new OnlineError('not_in_hand');
  if (hand.toAct !== seatIndex) throw new OnlineError('not_your_turn');

  const legal = legalActions(hand, seatIndex);
  const permitted =
    (move.type === 'check' && legal.canCheck) ||
    (move.type === 'call' && legal.canCall) ||
    (move.type === 'bet' && legal.canBet) ||
    (move.type === 'raise' && legal.canRaise) ||
    (move.type === 'fold' && legal.canFold) ||
    // allin: 専用の legal フラグは無い。手番であること自体が active であることを保証している。
    move.type === 'allin';
  if (!permitted) throw new OnlineError('illegal_action');
  // bet/raise の amount を legal.minBetTo〜maxBetTo で検証する(ON-1)。範囲外・非有限数(NaN/
  // Infinity/負数)を弾かないと applyAction の Math.min クランプ経由でスタック増加/pot破綻が起きる。
  if (!isValidBetAmount(move, legal)) throw new OnlineError('illegal_action');

  let newHand = applyAction(hand, seatIndex, move);
  newHand = progressToActionable(newHand);

  return persistHandTransition(db, roomId, tournament, newHand, seatUids, expectedVersion);
}

// ============================================================
// next_hand
// ============================================================

export async function nextHand(db: SupabaseClient, uid: string, roomId: string): Promise<{ version: number }> {
  await assertRoomMember(db, roomId, uid);

  const { data: stateRow, error: stateErr } = await db
    .from('room_states')
    .select('*')
    .eq('room_id', roomId)
    .maybeSingle();
  dbError(stateErr);
  if (!stateRow) throw new OnlineError('room_not_found');
  if (stateRow.phase !== 'hand_over') throw new OnlineError('illegal_action', 'not between hands');

  const { data: engineRow, error: engineErr } = await db
    .from('room_engine')
    .select('*')
    .eq('room_id', roomId)
    .maybeSingle();
  dbError(engineErr);
  if (!engineRow) throw new OnlineError('internal');

  const { tournament }: EngineState = engineRow.state;
  // phase が 'hand_over' なら通常ここは true のはず。念のための防御チェック。
  if (!canContinue(tournament)) throw new OnlineError('illegal_action', 'tournament already finished');

  const setup = setupHand(tournament);
  const config: GameConfig = { ...setup.config, rng: cryptoRng() };
  const hand = startHand(null, config, setup.seatStacks);

  return persistNewHand(db, roomId, tournament, hand, setup.uids, engineRow.version);
}

// ============================================================
// claim_timeout
// ============================================================

export async function claimTimeout(
  db: SupabaseClient,
  uid: string,
  roomId: string,
  expectedVersion: number,
  targetUid: string,
): Promise<{ version: number }> {
  await assertRoomMember(db, roomId, uid);

  const { data: stateRow, error: stateErr } = await db
    .from('room_states')
    .select('*')
    .eq('room_id', roomId)
    .maybeSingle();
  dbError(stateErr);
  if (!stateRow) throw new OnlineError('room_not_found');
  if (stateRow.version !== expectedVersion) throw new OnlineError('stale');

  // まだ締切前 → no-op success（誰でも呼べる claim なので、間違って早撃ちされても静かに無視する, §6.2）。
  if (!stateRow.action_deadline || new Date(stateRow.action_deadline).getTime() > Date.now()) {
    return { version: stateRow.version };
  }

  const { data: engineRow, error: engineErr } = await db
    .from('room_engine')
    .select('*')
    .eq('room_id', roomId)
    .maybeSingle();
  dbError(engineErr);
  if (!engineRow) throw new OnlineError('internal');

  const { tournament, hand }: EngineState = engineRow.state;
  const seatUids: string[] = engineRow.seat_uids;
  const seatIndex = seatUids.indexOf(targetUid);

  if (!hand || hand.toAct !== seatIndex) {
    // 対象が実際には手番ではない(古い/誤ったclaim) → no-op success。
    return { version: stateRow.version };
  }

  const legal = legalActions(hand, seatIndex);
  let newHand = applyAction(hand, seatIndex, legal.canCheck ? { type: 'check' } : { type: 'fold' });
  newHand = progressToActionable(newHand);

  return persistHandTransition(db, roomId, tournament, newHand, seatUids, engineRow.version);
}

// ============================================================
// heartbeat
// ============================================================

export async function heartbeat(db: SupabaseClient, uid: string, roomId: string): Promise<Record<string, never>> {
  await db
    .from('room_players')
    .update({ last_seen: new Date().toISOString(), connected: true })
    .eq('room_id', roomId)
    .eq('uid', uid);
  return {};
}

// ============================================================
// 内部共有ヘルパー
// ============================================================

/**
 * ハンド進行(player_action/claim_timeout)およびハンド途中の leave の共通後処理。
 * 「ハンドがこの呼び出しで確定した」「まだハンド継続中」「(leave由来で)そもそもハンドが無い」
 * の3パターンを吸収し、room_engine(楽観ロック) / room_states / room_players を一貫して更新する。
 */
async function persistHandTransition(
  db: SupabaseClient,
  roomId: string,
  tournament: TournamentState,
  hand: GameState | null,
  seatUids: string[],
  expectedVersion: number,
): Promise<{ version: number }> {
  const newVersion = expectedVersion + 1;

  let newTournament = tournament;
  let newHand: GameState | null = null;
  let newSeatUids: string[] = [];
  let phase: 'in_hand' | 'hand_over' | 'finished';
  let actionDeadline: string | null;
  let handNumberForStates: number;
  // room_states.public に反映するハンド。null なら「今回は書き換えない」の意味（下で分岐）。
  let publicHand: GameState | null = null;
  let publicSeatUids = seatUids;

  if (hand !== null && hand.street === 'showdown' && hand.result) {
    // ハンドがこの呼び出しで確定した。
    // (markLeft 済みの 'left' プレイヤーは applyHandResult 側が反映対象外にするため、
    //  ここで stack を正規化する必要はない)
    newTournament = applyHandResult(tournament, hand, seatUids);
    newHand = null;
    newSeatUids = [];
    phase = newTournament.status === 'finished' ? 'finished' : 'hand_over';
    actionDeadline = null;
    // applyHandResult の handNumber は「今終わったハンドの番号」(t.handNumber + 1)。
    handNumberForStates = newTournament.handNumber;
    // 次ハンド開始まで、直前ハンドの最終状態(ショーダウン公開)をクライアントに見せ続ける。
    publicHand = hand;
    publicSeatUids = seatUids;
  } else if (hand !== null) {
    // まだハンド継続中(progressToActionable により toAct!==null が保証されている)。
    newHand = hand;
    newSeatUids = seatUids;
    phase = 'in_hand';
    actionDeadline = new Date(Date.now() + 30_000).toISOString();
    // tournament.handNumber は「完了済みハンド数」。進行中ハンドの番号はその+1。
    handNumberForStates = tournament.handNumber + 1;
    publicHand = hand;
    publicSeatUids = seatUids;
  } else {
    // ハンド間(next_hand待ち)での leave 等。ハンド自体は無く tournament(生存者/順位)だけ変わる。
    newHand = null;
    newSeatUids = [];
    phase = newTournament.status === 'finished' ? 'finished' : 'hand_over';
    actionDeadline = null;
    handNumberForStates = tournament.handNumber;
    publicHand = null; // room_states.public は据え置き(直前ハンドの表示のまま)
  }

  const { data: updated, error: updateErr } = await db
    .from('room_engine')
    .update({
      version: newVersion,
      state: { tournament: newTournament, hand: newHand },
      seat_uids: newSeatUids,
      updated_at: new Date().toISOString(),
    })
    .eq('room_id', roomId)
    .eq('version', expectedVersion)
    .select();
  dbError(updateErr);
  if (!updated || updated.length === 0) throw new OnlineError('stale');

  if (publicHand !== null) {
    const { data: playersRows } = await db.from('room_players').select('uid, display_name').eq('room_id', roomId);
    const names: Record<string, string> = Object.fromEntries(
      (playersRows ?? []).map((p: { uid: string; display_name: string }) => [p.uid, p.display_name]),
    );
    const publicState = toPublicState(publicHand, publicSeatUids, names);
    const { error: statesErr } = await db
      .from('room_states')
      .update({
        version: newVersion,
        hand_number: handNumberForStates,
        phase,
        public: publicState,
        // TournamentState は hole/deck を含まないので全体をミラーしてよい
        // （結果画面の stackCurve/順位表示はクライアントがここを読む）。
        tournament: newTournament,
        action_deadline: actionDeadline,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId);
    dbError(statesErr);
  } else {
    const { error: statesErr } = await db
      .from('room_states')
      .update({ version: newVersion, phase, tournament: newTournament, updated_at: new Date().toISOString() })
      .eq('room_id', roomId);
    dbError(statesErr);
  }

  // 全プレイヤーの stack/status/finish_rank を毎回まとめて同期する
  // (hand の参加者に限定しないほうが leave 等のケースでも取りこぼしなくシンプル)。
  for (const p of newTournament.players) {
    const { error } = await db
      .from('room_players')
      .update({ stack: Math.round(p.stack), status: p.status, finish_rank: p.finishRank })
      .eq('room_id', roomId)
      .eq('uid', p.uid);
    dbError(error);
  }

  if (newTournament.status === 'finished') {
    const { error } = await db.from('rooms').update({ status: 'finished' }).eq('id', roomId);
    dbError(error);
  }

  return { version: newVersion };
}

/**
 * 新しいハンドを配って永続化する。start_game(expectedVersion=null, room_engine行を新規insert)と
 * next_hand(expectedVersion=既存version, 条件付きupdate)の両方から使う共通ロジック。
 */
async function persistNewHand(
  db: SupabaseClient,
  roomId: string,
  tournament: TournamentState,
  hand: GameState,
  uids: string[],
  expectedVersion: number | null,
): Promise<{ version: number }> {
  const newVersion = expectedVersion === null ? 0 : expectedVersion + 1;
  // tournament.handNumber は「完了済みハンド数」。setupHand/startHand は常に次のハンドを配る。
  const handNumber = tournament.handNumber + 1;

  if (expectedVersion === null) {
    const { error } = await db
      .from('room_engine')
      .insert({ room_id: roomId, version: 0, state: { tournament, hand }, seat_uids: uids });
    dbError(error);
  } else {
    const { data, error } = await db
      .from('room_engine')
      .update({
        version: newVersion,
        state: { tournament, hand },
        seat_uids: uids,
        updated_at: new Date().toISOString(),
      })
      .eq('room_id', roomId)
      .eq('version', expectedVersion)
      .select();
    dbError(error);
    if (!data || data.length === 0) throw new OnlineError('stale');
  }

  const { data: playersRows } = await db.from('room_players').select('uid, display_name').eq('room_id', roomId);
  const names: Record<string, string> = Object.fromEntries(
    (playersRows ?? []).map((p: { uid: string; display_name: string }) => [p.uid, p.display_name]),
  );
  const publicState = toPublicState(hand, uids, names);

  const { error: statesErr } = await db
    .from('room_states')
    .update({
      version: newVersion,
      hand_number: handNumber,
      phase: 'in_hand',
      public: publicState,
      tournament,
      action_deadline: new Date(Date.now() + 30_000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('room_id', roomId);
  dbError(statesErr);

  for (const p of tournament.players) {
    const { error } = await db
      .from('room_players')
      .update({ stack: Math.round(p.stack), status: p.status, finish_rank: p.finishRank })
      .eq('room_id', roomId)
      .eq('uid', p.uid);
    dbError(error);
  }

  for (let i = 0; i < uids.length; i++) {
    const { error } = await db
      .from('room_hole_cards')
      .insert({ room_id: roomId, hand_number: handNumber, uid: uids[i], hole: hand.players[i].hole });
    dbError(error);
  }

  return { version: newVersion };
}
