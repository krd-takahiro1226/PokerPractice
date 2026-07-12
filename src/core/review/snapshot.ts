import type { Card } from '../cards';
import type { Position } from '../ranges/types';
import type { Street, PlayerActionType, HandLogEntry } from '../game/types';
import type { LegalActions } from '../game/engine';
import type { SavedHand } from '../../store/history';

/** ヒーロー判断時点の盤面復元結果。保存しない・都度計算（docs/SOLVER-REVIEW-DESIGN.md §3.4）。 */
export type DecisionSnapshot = {
  logIndex: number;
  street: Street;
  actor: { playerId: number; pos: Position; isHero: boolean };
  board: Card[];
  /** アクター視点のポット（自分の今回分を含まない） */
  potBefore: number;
  /** コールに必要な追加支払い額(bb)。0 = check可 */
  toCall: number;
  legal: LegalActions;
  players: {
    playerId: number;
    pos: Position;
    stack: number;
    committedStreet: number;
    committedTotal: number;
    status: 'active' | 'folded' | 'allin';
  }[];
  /** hero stack と生存相手の最大スタックの小さい方 */
  effectiveStack: number;
  spr: number | null;
  /** ビッグブラインドサイズ。preflop レイズ数の判定（allin レイズ含む）に使う */
  bb: number;
  actionHistory: HandLogEntry[];
  context: {
    openerPos?: Position;
    lastAggressorId?: number;
    heroHasInitiative: boolean;
    villainIds: number[];
    isMultiway: boolean;
    facingBet?: { amount: number; potRatio: number; from: Position };
  };
  taken: {
    action: PlayerActionType;
    amountTo?: number;
    additional?: number;
    potRatio?: number;
  };
  reliability: 'exact' | 'approx';
};

// engine.ts の POS_FROM_BTN_BY_N の写し。engine は変更禁止（オラクル利用のみ）のため
// export せずここに複製し、オラクルテストで一致を担保する。
const POS_FROM_BTN_BY_N: Record<number, Position[]> = {
  2: ['SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'CO'],
  5: ['BTN', 'SB', 'BB', 'HJ', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
};

const EPSILON = 1e-6;

type Seat = {
  playerId: number;
  pos: Position;
  stack: number;
  committedStreet: number;
  committedTotal: number;
  status: 'active' | 'folded' | 'allin';
  hasActedThisStreet: boolean;
};

type Setup = {
  seats: Seat[];
  blinds: { sb: number; bb: number; ante: number };
  buttonSeat: number;
  reliability: 'exact' | 'approx';
};

function isV3(hand: SavedHand): boolean {
  return (
    (hand.version ?? 0) >= 3 &&
    Array.isArray(hand.stacks) &&
    hand.blinds !== undefined &&
    hand.buttonSeat !== undefined &&
    hand.playerCount !== undefined &&
    hand.stacks.length === hand.playerCount &&
    POS_FROM_BTN_BY_N[hand.playerCount] !== undefined
  );
}

function setupFromV3(hand: SavedHand): Setup {
  const n = hand.playerCount!;
  const posFromBtn = POS_FROM_BTN_BY_N[n];
  const seats: Seat[] = Array.from({ length: n }, (_, id) => ({
    playerId: id,
    pos: posFromBtn[(id - hand.buttonSeat! + n * 2) % n],
    stack: hand.stacks![id],
    committedStreet: 0,
    committedTotal: 0,
    status: 'active',
    hasActedThisStreet: false,
  }));
  return { seats, blinds: { ...hand.blinds! }, buttonSeat: hand.buttonSeat!, reliability: 'exact' };
}

/** v2 以前: ログの playerId×pos から座席を復元し、スタック 100bb・標準ブラインドを仮定する。 */
function setupFromLegacy(hand: SavedHand): Setup {
  const posById = new Map<number, Position>();
  for (const e of hand.log) {
    if (!posById.has(e.playerId)) posById.set(e.playerId, e.pos);
  }
  // 観測ポジションからテーブルサイズを推定（プリフロップで BB 以外は必ずアクションする）
  const observed = new Set(posById.values());
  const n = observed.has('UTG') ? 6
    : observed.has('HJ') ? 5
    : observed.has('CO') ? 4
    : observed.has('BTN') ? 3
    : 2;
  // 未観測の席（BB のウォーク等）を残りの id × 残りのポジションで補完
  const posFromBtn = POS_FROM_BTN_BY_N[n];
  const missingPos = posFromBtn.filter((p) => !observed.has(p));
  const missingIds = Array.from({ length: n }, (_, id) => id).filter((id) => !posById.has(id));
  for (let i = 0; i < missingIds.length; i++) {
    if (missingPos[i]) posById.set(missingIds[i], missingPos[i]);
  }
  const seats: Seat[] = Array.from({ length: n }, (_, id) => ({
    playerId: id,
    pos: posById.get(id) ?? posFromBtn[id % n],
    stack: 100,
    committedStreet: 0,
    committedTotal: 0,
    status: 'active',
    hasActedThisStreet: false,
  }));
  const btnPos: Position = n === 2 ? 'SB' : 'BTN';
  const buttonSeat = seats.find((s) => s.pos === btnPos)?.playerId ?? 0;
  const ante = (hand.mode ?? 'tournament') === 'tournament' ? 1 : 0;
  return { seats, blinds: { sb: 0.5, bb: 1, ante }, buttonSeat, reliability: 'approx' };
}

type Replay = {
  seats: Seat[];
  street: Street;
  pot: number;              // 確定済みポット（前ストリートまで + ante）
  currentBet: number;
  minRaise: number;
  /** currentBet を最後に引き上げたプレイヤー（プリフロップ初期値は BB） */
  currentBetOwner: number | null;
  /** ハンド全体で最後に bet/raise したプレイヤー（ストリートを跨いで保持） */
  lastAggressorId: number | null;
  openerPos?: Position;
  bb: number;
  anyMismatch: boolean;
};

function postBlinds(setup: Setup): Replay {
  const { seats, blinds } = setup;
  const sbSeat = seats.find((s) => s.pos === 'SB');
  const bbSeat = seats.find((s) => s.pos === 'BB');
  let pot = 0;
  let currentBet = 0;
  if (sbSeat) {
    const amt = Math.min(blinds.sb, sbSeat.stack);
    sbSeat.stack -= amt;
    sbSeat.committedStreet = amt;
    sbSeat.committedTotal = amt;
    if (sbSeat.stack === 0) sbSeat.status = 'allin';
  }
  if (bbSeat) {
    const amt = Math.min(blinds.bb, bbSeat.stack);
    bbSeat.stack -= amt;
    bbSeat.committedStreet = amt;
    bbSeat.committedTotal = amt;
    if (bbSeat.stack === 0) bbSeat.status = 'allin';
    currentBet = amt;
    // ante は pot 初期値として先に積む（committedStreet には加算しない = engine と同じ）
    const ante = Math.min(blinds.ante, bbSeat.stack);
    if (ante > 0) {
      bbSeat.stack -= ante;
      bbSeat.committedTotal += ante;
      if (bbSeat.stack <= 0) bbSeat.status = 'allin';
      pot = ante;
    }
  }
  return {
    seats,
    street: 'preflop',
    pot,
    currentBet,
    minRaise: blinds.bb,
    currentBetOwner: bbSeat?.playerId ?? null,
    lastAggressorId: null,
    bb: blinds.bb,
    anyMismatch: false,
  };
}

function totalPot(r: Replay): number {
  return r.pot + r.seats.reduce((s, p) => s + p.committedStreet, 0);
}

const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river'];

function advanceReplayStreet(r: Replay, to: Street): void {
  while (r.street !== to) {
    const idx = STREET_ORDER.indexOf(r.street);
    const next = STREET_ORDER[idx + 1];
    if (!next) break;
    r.pot += r.seats.reduce((s, p) => s + p.committedStreet, 0);
    for (const s of r.seats) {
      s.committedStreet = 0;
      s.hasActedThisStreet = false;
    }
    r.currentBet = 0;
    r.minRaise = r.bb;
    r.currentBetOwner = null;
    r.street = next;
  }
}

function boardAtStreet(board: Card[], street: Street): Card[] {
  switch (street) {
    case 'preflop': return [];
    case 'flop': return board.slice(0, 3);
    case 'turn': return board.slice(0, 4);
    default: return board.slice(0, 5);
  }
}

/** engine.legalActions の写し（Replay 状態版）。 */
function legalFor(r: Replay, seat: Seat): LegalActions {
  const maxBetTo = seat.committedStreet + seat.stack;
  const callAmount = Math.min(r.currentBet - seat.committedStreet, seat.stack);
  const canCheck = r.currentBet === seat.committedStreet;
  const canCall = !canCheck && callAmount > 0;
  const canBet = r.currentBet === 0 && seat.stack > 0;
  const canRaise = r.currentBet > 0 && seat.stack > callAmount && !seat.hasActedThisStreet;
  let minBetTo: number;
  if (canBet) {
    minBetTo = Math.min(r.bb, maxBetTo);
  } else if (canRaise) {
    minBetTo = Math.min(r.currentBet + r.minRaise, maxBetTo);
  } else {
    minBetTo = maxBetTo;
  }
  return { canFold: true, canCheck, canCall, callAmount, canBet, canRaise, minBetTo, maxBetTo };
}

/** engine.applyAction の会計部分の写し。log の amount（実到達 total-commit）を真値として使う。 */
function applyEntry(r: Replay, entry: HandLogEntry): void {
  const seat = r.seats[entry.playerId];
  if (!seat) {
    r.anyMismatch = true;
    return;
  }
  const resetOthers = () => {
    for (const other of r.seats) {
      if (other.playerId !== seat.playerId && other.status === 'active') {
        other.hasActedThisStreet = false;
      }
    }
  };
  switch (entry.action) {
    case 'fold':
      seat.status = 'folded';
      seat.hasActedThisStreet = true;
      break;
    case 'check':
      seat.hasActedThisStreet = true;
      break;
    case 'call': {
      const target = entry.amount ?? r.currentBet;
      const additional = Math.max(0, Math.min(target - seat.committedStreet, seat.stack));
      seat.stack -= additional;
      seat.committedStreet += additional;
      seat.committedTotal += additional;
      seat.hasActedThisStreet = true;
      if (seat.stack === 0) seat.status = 'allin';
      break;
    }
    case 'bet': {
      const betTo = entry.amount ?? r.bb;
      const additional = Math.max(0, Math.min(betTo - seat.committedStreet, seat.stack));
      const newCommit = seat.committedStreet + additional;
      r.minRaise = newCommit - r.currentBet;
      r.currentBet = newCommit;
      r.currentBetOwner = seat.playerId;
      r.lastAggressorId = seat.playerId;
      seat.stack -= additional;
      seat.committedStreet = newCommit;
      seat.committedTotal += additional;
      seat.hasActedThisStreet = true;
      if (seat.stack === 0) seat.status = 'allin';
      resetOthers();
      noteOpener(r, seat);
      break;
    }
    case 'raise': {
      const raiseTo = entry.amount ?? r.currentBet + r.minRaise;
      const additional = Math.max(0, Math.min(raiseTo - seat.committedStreet, seat.stack));
      const newCommit = seat.committedStreet + additional;
      r.minRaise = Math.max(r.minRaise, newCommit - r.currentBet);
      r.currentBet = newCommit;
      r.currentBetOwner = seat.playerId;
      r.lastAggressorId = seat.playerId;
      seat.stack -= additional;
      seat.committedStreet = newCommit;
      seat.committedTotal += additional;
      seat.hasActedThisStreet = true;
      if (seat.stack === 0) seat.status = 'allin';
      resetOthers();
      noteOpener(r, seat);
      break;
    }
    case 'allin': {
      const additional = seat.stack;
      const newCommit = seat.committedStreet + additional;
      if (newCommit > r.currentBet) {
        const increment = newCommit - r.currentBet;
        const isFullRaise = increment >= r.minRaise;
        r.minRaise = Math.max(r.minRaise, increment);
        r.currentBet = newCommit;
        r.currentBetOwner = seat.playerId;
        r.lastAggressorId = seat.playerId;
        if (isFullRaise) resetOthers();
        noteOpener(r, seat);
      }
      seat.stack = 0;
      seat.committedStreet = newCommit;
      seat.committedTotal += additional;
      seat.hasActedThisStreet = true;
      seat.status = 'allin';
      break;
    }
  }
}

/** プリフロップで最初に BB 超まで引き上げたプレイヤー = オープナー。 */
function noteOpener(r: Replay, seat: Seat): void {
  if (r.street === 'preflop' && r.openerPos === undefined && r.currentBet > r.bb + EPSILON) {
    r.openerPos = seat.pos;
  }
}

function buildSnapshot(
  r: Replay,
  hand: SavedHand,
  entry: HandLogEntry,
  logIndex: number,
  reliability: 'exact' | 'approx',
): DecisionSnapshot {
  const seat = r.seats[entry.playerId];
  const legal = legalFor(r, seat);
  const potBefore = totalPot(r);
  const toCall = Math.max(0, legal.callAmount);
  const villains = r.seats.filter((s) => s.playerId !== seat.playerId && s.status !== 'folded');
  const villainIds = villains.map((s) => s.playerId);
  const maxVillainStack = villains.reduce((m, s) => Math.max(m, s.stack), 0);
  const effectiveStack = Math.min(seat.stack, maxVillainStack);
  const heroHasInitiative = r.lastAggressorId === seat.playerId;

  let facingBet: DecisionSnapshot['context']['facingBet'];
  if (toCall > EPSILON && r.currentBetOwner !== null) {
    const owner = r.seats[r.currentBetOwner];
    const potWithoutCall = potBefore - toCall;
    facingBet = {
      amount: toCall,
      potRatio: potWithoutCall > EPSILON ? toCall / potWithoutCall : 1,
      from: owner?.pos ?? seat.pos,
    };
  }

  const amountTo = entry.action === 'fold' || entry.action === 'check' ? undefined : entry.amount;
  const additional =
    amountTo !== undefined
      ? Math.max(0, Math.min(amountTo - seat.committedStreet, seat.stack))
      : entry.action === 'call'
        ? toCall
        : undefined;

  return {
    logIndex,
    street: r.street,
    actor: { playerId: seat.playerId, pos: seat.pos, isHero: seat.playerId === 0 },
    board: boardAtStreet(hand.board, r.street),
    potBefore,
    toCall,
    legal,
    players: r.seats.map((s) => ({
      playerId: s.playerId,
      pos: s.pos,
      stack: s.stack,
      committedStreet: s.committedStreet,
      committedTotal: s.committedTotal,
      status: s.status,
    })),
    effectiveStack,
    spr: potBefore > EPSILON ? effectiveStack / potBefore : null,
    bb: r.bb,
    actionHistory: hand.log.slice(0, logIndex),
    context: {
      openerPos: r.openerPos,
      lastAggressorId: r.lastAggressorId ?? undefined,
      heroHasInitiative,
      villainIds,
      isMultiway: villainIds.length >= 2,
      facingBet,
    },
    taken: {
      action: entry.action,
      amountTo,
      additional,
      potRatio:
        additional !== undefined && additional > EPSILON && potBefore > EPSILON
          ? additional / potBefore
          : undefined,
    },
    reliability,
  };
}

/** v2 フォールバック時、最初のプリフロップエントリの potAfter から ante を逆算する。
 *  pot 初期値（=ante）は committedStreet 会計に現れないため、差分がそのまま ante。 */
function inferAnteFromLog(setup: Setup, hand: SavedHand): number {
  const first = hand.log.find((e) => e.street === 'preflop');
  if (!first) return setup.blinds.ante;
  const seats = setup.seats.map((s) => ({ ...s }));
  const trial = postBlinds({ ...setup, seats, blinds: { ...setup.blinds, ante: 0 } });
  applyEntry(trial, first);
  const inferred = first.potAfter - totalPot(trial);
  if (inferred < EPSILON) return 0;
  // sb/bb 仮定ずれ等でノイズが乗った場合は 0.25bb 単位に丸めた非負値のみ採用
  return Math.round(inferred * 4) / 4;
}

/** SavedHand から各ヒーロー判断時点の DecisionSnapshot を復元する。
 *  エンジンは呼ばず、log の total-commit 会計を積算する（docs/SOLVER-REVIEW-DESIGN.md §3.4）。
 *  各エントリ適用後に potAfter と突合し、不一致は例外にせず reliability='approx' へ降格する。 */
export function buildSnapshots(hand: SavedHand): DecisionSnapshot[] {
  const setup = isV3(hand) ? setupFromV3(hand) : setupFromLegacy(hand);
  if (setup.reliability === 'approx') {
    setup.blinds.ante = inferAnteFromLog(setup, hand);
  }
  const r = postBlinds(setup);

  const snapshots: DecisionSnapshot[] = [];
  for (let i = 0; i < hand.log.length; i++) {
    const entry = hand.log[i];
    if (entry.street === 'showdown') break;
    advanceReplayStreet(r, entry.street);
    if (entry.playerId === 0) {
      snapshots.push(buildSnapshot(r, hand, entry, i, setup.reliability));
    }
    applyEntry(r, entry);
    if (Math.abs(totalPot(r) - entry.potAfter) > EPSILON) {
      r.anyMismatch = true;
    }
  }

  if (setup.reliability === 'approx' || r.anyMismatch) {
    for (const s of snapshots) s.reliability = 'approx';
  }
  return snapshots;
}
