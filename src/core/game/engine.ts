import { POSITIONS, type Position } from '../ranges/types';
import { shuffleDeck, dealCards } from './deck';
import { evaluateShowdown } from './showdown';
import type {
  GameConfig,
  GameState,
  PlayerState,
  PlayerAction,
  HandLogEntry,
  Street,
} from './types';

export type LegalActions = {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;          // 追加支払い額(bb)
  canBet: boolean;
  canRaise: boolean;
  minBetTo: number;            // bet/raise の最小 total-commit 目標額
  maxBetTo: number;            // all-in 上限の total-commit 目標額
};

// ポジション配列: インデックス0=UTG相当（BTNの+1）、時計回り
const POS_ORDER: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

// button 相対ポジション配列（index0 = button から時計回り）。n=2..6 対応。
// n=6 は現行 assignPositions と完全一致（既存挙動を変えない）。
const POS_FROM_BTN_BY_N: Record<number, Position[]> = {
  2: ['SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'CO'],
  5: ['BTN', 'SB', 'BB', 'HJ', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
};

/** 座席(id)をポジションにマップする。buttonSeat=BTN（n=2ではSB）。n=2..6 対応。 */
function assignPositions(buttonSeat: number, n: number): Record<number, Position> {
  const posFromBtn = POS_FROM_BTN_BY_N[n];
  if (!posFromBtn) {
    throw new Error(`Unsupported table size: ${n} (supported: 2-6)`);
  }
  const result: Record<number, Position> = {};
  for (let i = 0; i < n; i++) {
    const seat = (buttonSeat + i) % n;
    result[seat] = posFromBtn[i];
  }
  return result;
}

/** ポジション順での次のプレイヤーidを返す（時計回り）。 */
function nextSeat(current: number, n: number): number {
  return (current + 1) % n;
}

/** プリフロップのアクション順: UTG → HJ → CO → BTN → SB → BB（最初の入場者）。
 *  ブラインド投下後、最初のアクションはBBの次（6-maxではUTG）。 */
function preflopFirstToAct(players: PlayerState[], n: number): number | null {
  // BB の id を見つける
  const bb = players.find((p) => p.pos === 'BB');
  if (!bb) return null;
  // BB の次が最初のアクション
  return nextActiveFrom(players, nextSeat(bb.id, n), n);
}

/** ポストフロップのアクション順: button の次（=SB相当）から時計回り（最初のactive）。
 *  6-maxでは button+1=SB で従来と同値。HU(n=2)では button+1=BB となり正しい（HUはBBが先手）。 */
function postflopFirstToAct(buttonSeat: number, players: PlayerState[], n: number): number | null {
  return nextActiveFrom(players, (buttonSeat + 1) % n, n);
}

/** seat から時計回りで最初の active プレイヤーの id を返す（全folded/allin なら null）。 */
function nextActiveFrom(players: PlayerState[], fromSeat: number, n: number): number | null {
  for (let i = 0; i < n; i++) {
    const seat = (fromSeat + i) % n;
    const p = players[seat];
    if (p && p.status === 'active') return seat;
  }
  return null;
}

/** 現ストリートでまだアクションが必要なプレイヤーを見つける。 */
function nextToActInRound(state: GameState, afterSeat: number): number | null {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const seat = (afterSeat + i) % n;
    const p = state.players[seat];
    if (!p || p.status !== 'active') continue;
    // まだアクションしていないか、currentBet に達していない
    if (!p.hasActedThisStreet || p.committedStreet < state.currentBet) {
      return seat;
    }
  }
  return null;
}

/** 現在のポット合計（確定分 + 現ストリート拠出分）。 */
function totalPot(state: GameState): number {
  const streetCommits = state.players.reduce((s, p) => s + p.committedStreet, 0);
  return state.pot + streetCommits;
}

export function startHand(
  prev: GameState | null,
  config: GameConfig,
  seatStacks?: number[],
): GameState {
  const rng = config.rng ?? Math.random;

  // 席数 n: seatStacks 指定時はその長さ、省略時は 6（既存 6-max 単発/セッション互換）。
  const n = seatStacks ? seatStacks.length : 6;

  const handNumber = prev ? prev.handNumber + 1 : 1;
  // BTN を毎ハンド +1 ローテーション
  const buttonSeat = prev ? (prev.buttonSeat + 1) % n : 0;

  const posMap = assignPositions(buttonSeat, n);
  const deck = shuffleDeck(rng);

  // seatStacks 指定時は各席の初期スタックに使う。省略時は config.startingStack。
  let players: PlayerState[] = Array.from({ length: n }, (_, id) => ({
    id,
    isHero: id === 0,
    pos: posMap[id],
    stack: seatStacks ? seatStacks[id] : config.startingStack,
    hole: null,
    committedTotal: 0,
    committedStreet: 0,
    status: 'active' as const,
    hasActedThisStreet: false,
  }));

  // ホールカードを配る（各2枚）。
  // n=6 は既存の「UTGから配る」(buttonSeat+3起点)と完全一致させ、既存テスト/シード依存挙動を変えない。
  // n!=6 は起点がどこでも配布の公平性に影響しないため SB 起点（buttonSeat+1）とする。
  let remaining = deck;
  const dealFrom = n === 6 ? (buttonSeat + 3) % n : (buttonSeat + 1) % n;
  for (let i = 0; i < n; i++) {
    const seat = (dealFrom + i) % n;
    const [dealt, rest] = dealCards(remaining, 2);
    players[seat] = { ...players[seat], hole: [dealt[0], dealt[1]] };
    remaining = rest;
  }

  // SB・BB のブラインド投下
  const sbPlayer = players.find((p) => p.pos === 'SB')!;
  const bbPlayer = players.find((p) => p.pos === 'BB')!;

  // 呼び出し側（session.ts 等）は stack<=0 の席を次ハンドの seatStacks から除外する契約になっている。
  // ここに到達するのは呼び出し側のバグ（ゾンビ席がブラインドを課され currentBet が壊れる）なので、
  // 静かに 0 を課すのではなく早期に検出して失敗させる。
  if (sbPlayer.stack <= 0 || bbPlayer.stack <= 0) {
    throw new Error(
      `startHand: SB/BB seat has stack<=0 (sb seat ${sbPlayer.id}=${sbPlayer.stack}, bb seat ${bbPlayer.id}=${bbPlayer.stack}). Zero-stack seats must be excluded from seatStacks before starting a new hand.`,
    );
  }

  const sbAmount = Math.min(config.sb, sbPlayer.stack);
  const bbAmount = Math.min(config.bb, bbPlayer.stack);

  players = players.map((p) => {
    if (p.id === sbPlayer.id) {
      return {
        ...p,
        stack: p.stack - sbAmount,
        committedStreet: sbAmount,
        committedTotal: sbAmount,
        status: sbAmount >= p.stack + sbAmount ? 'allin' : 'active',
      };
    }
    if (p.id === bbPlayer.id) {
      return {
        ...p,
        stack: p.stack - bbAmount,
        committedStreet: bbAmount,
        committedTotal: bbAmount,
        status: bbAmount >= p.stack + bbAmount ? 'allin' : 'active',
      };
    }
    return p;
  });

  // SBがall-inになった場合の修正
  players = players.map((p) => {
    if (p.id === sbPlayer.id && p.stack === 0) return { ...p, status: 'allin' as const };
    if (p.id === bbPlayer.id && p.stack === 0) return { ...p, status: 'allin' as const };
    return p;
  });

  // BB ante: BB が全員分の ante を追加投下（dead money としてポットに入れる）
  // ante は committedStreet に加算しない（コール額を増やさないため）
  const bbAfterBlind = players.find((p) => p.pos === 'BB')!;
  const anteAmount = Math.min(config.ante ?? 0, bbAfterBlind.stack);
  if (anteAmount > 0) {
    players = players.map((p) => {
      if (p.id !== bbAfterBlind.id) return p;
      return {
        ...p,
        stack: p.stack - anteAmount,
        committedTotal: p.committedTotal + anteAmount,
        status: p.stack - anteAmount <= 0 ? 'allin' as const : p.status,
      };
    });
  }

  const firstToAct = preflopFirstToAct(players, n);

  return {
    config,
    handNumber,
    buttonSeat,
    players,
    board: [],
    deck: remaining,
    street: 'preflop',
    pot: anteAmount,        // ante を確定ポットへ
    currentBet: bbAmount,   // ante はコール額に影響しない
    minRaise: config.bb,
    toAct: firstToAct,
    lastAggressor: null,
    log: [],
    result: null,
  };
}

export function legalActions(state: GameState, playerId: number): LegalActions {
  const player = state.players[playerId];
  const maxBetTo = player.committedStreet + player.stack;

  const callTarget = state.currentBet;
  const callAmount = Math.min(callTarget - player.committedStreet, player.stack);

  const canCheck = state.currentBet === player.committedStreet;
  const canCall = !canCheck && callAmount > 0;

  // bet: currentBet=0 の場合のみ
  const canBet = state.currentBet === 0 && player.stack > 0;
  // raise: currentBet>0 かつ、自分がall-inでない
  // hasActedThisStreet が true のまま手番が来るのは最小レイズ未満のショートオールインに
  // 直面した場合のみ（フルレイズならフラグがリセットされる）。この場合コール/フォールドのみ
  const canRaise =
    state.currentBet > 0 && player.stack > callAmount && !player.hasActedThisStreet;

  // min bet: bb以上
  // min raise: currentBet + minRaise（total-commit目標額）
  let minBetTo: number;
  if (canBet) {
    minBetTo = Math.min(state.config.bb, maxBetTo);
  } else if (canRaise) {
    minBetTo = Math.min(state.currentBet + state.minRaise, maxBetTo);
  } else {
    minBetTo = maxBetTo;
  }

  return {
    canFold: true,
    canCheck,
    canCall,
    callAmount,
    canBet,
    canRaise,
    minBetTo,
    maxBetTo,
  };
}

export function isBettingRoundComplete(state: GameState): boolean {
  const activePlayers = state.players.filter((p) => p.status === 'active');
  if (activePlayers.length === 0) return true;

  return activePlayers.every(
    (p) => p.hasActedThisStreet && p.committedStreet === state.currentBet,
  );
}

export function applyAction(
  state: GameState,
  playerId: number,
  action: PlayerAction,
): GameState {
  const player = state.players[playerId];
  if (!player || player.status !== 'active') {
    throw new Error(`Player ${playerId} cannot act (status: ${player?.status})`);
  }
  if (state.toAct !== playerId) {
    throw new Error(`Not player ${playerId}'s turn (toAct=${state.toAct})`);
  }

  let players = state.players.map((p) => ({ ...p }));
  let pot = state.pot;
  let currentBet = state.currentBet;
  let minRaise = state.minRaise;
  let lastAggressor = state.lastAggressor;
  const log = [...state.log];

  const p = players[playerId];

  switch (action.type) {
    case 'fold': {
      p.status = 'folded';
      p.hasActedThisStreet = true;
      break;
    }

    case 'check': {
      if (currentBet !== p.committedStreet) {
        throw new Error(`Cannot check: currentBet=${currentBet} committedStreet=${p.committedStreet}`);
      }
      p.hasActedThisStreet = true;
      break;
    }

    case 'call': {
      const target = currentBet;
      const additional = Math.min(target - p.committedStreet, p.stack);
      p.stack -= additional;
      p.committedStreet += additional;
      p.committedTotal += additional;
      p.hasActedThisStreet = true;
      // スタックが0になったらall-in
      if (p.stack === 0) p.status = 'allin';
      break;
    }

    case 'bet': {
      if (currentBet !== 0) {
        throw new Error(`Cannot bet: currentBet=${currentBet} (use raise)`);
      }
      // amount が非有限数（NaN/Infinity等）や不正値でも additional が負にならないよう防御する
      const betTo = Number.isFinite(action.amount) ? (action.amount as number) : state.config.bb;
      const additional = Math.max(0, Math.min(betTo - p.committedStreet, p.stack));
      const newCommit = p.committedStreet + additional;
      minRaise = newCommit - currentBet;
      currentBet = newCommit;
      p.stack -= additional;
      p.committedStreet = newCommit;
      p.committedTotal += additional;
      p.hasActedThisStreet = true;
      lastAggressor = playerId;
      if (p.stack === 0) p.status = 'allin';
      // 他のactiveプレイヤーのhasActedThisStreetをリセット
      for (const other of players) {
        if (other.id !== playerId && other.status === 'active') {
          other.hasActedThisStreet = false;
        }
      }
      break;
    }

    case 'raise': {
      if (currentBet === 0) {
        throw new Error('Cannot raise: currentBet=0 (use bet)');
      }
      // amount が非有限数（NaN/Infinity等）や不正値でも additional が負にならないよう防御する
      const raiseTo = Number.isFinite(action.amount) ? (action.amount as number) : (currentBet + minRaise);
      const additional = Math.max(0, Math.min(raiseTo - p.committedStreet, p.stack));
      const newCommit = p.committedStreet + additional;
      // minRaiseはレイズの増分
      minRaise = Math.max(minRaise, newCommit - currentBet);
      currentBet = newCommit;
      p.stack -= additional;
      p.committedStreet = newCommit;
      p.committedTotal += additional;
      p.hasActedThisStreet = true;
      lastAggressor = playerId;
      if (p.stack === 0) p.status = 'allin';
      // 他のactiveプレイヤーのhasActedThisStreetをリセット
      for (const other of players) {
        if (other.id !== playerId && other.status === 'active') {
          other.hasActedThisStreet = false;
        }
      }
      break;
    }

    case 'allin': {
      const additional = p.stack;
      const newCommit = p.committedStreet + additional;
      if (newCommit > currentBet) {
        // raise/bet 相当
        const raiseIncrement = newCommit - currentBet;
        // 最小レイズ以上のフルレイズ相当か（NLHルール: 最小レイズ未満のショートオールインは
        // レイズ権を再オープンしない。既にアクション済みのプレイヤーはコール/フォールドのみ）
        const isFullRaise = raiseIncrement >= minRaise;
        minRaise = Math.max(minRaise, raiseIncrement);
        currentBet = newCommit;
        lastAggressor = playerId;
        if (isFullRaise) {
          // 他のactiveプレイヤーのhasActedThisStreetをリセット
          for (const other of players) {
            if (other.id !== playerId && other.status === 'active') {
              other.hasActedThisStreet = false;
            }
          }
        }
      }
      p.stack = 0;
      p.committedStreet = newCommit;
      p.committedTotal += additional;
      p.hasActedThisStreet = true;
      p.status = 'allin';
      break;
    }

    default:
      throw new Error(`Unknown action type: ${(action as PlayerAction).type}`);
  }

  // ログ記録。amount は実際の到達 total-commit を記録する（call/allin は action.amount を
  // 持たないため、適用後の committedStreet が唯一の正確な値）
  const logEntry: HandLogEntry = {
    street: state.street,
    playerId,
    pos: player.pos,
    action: action.type,
    amount: action.type === 'fold' || action.type === 'check' ? undefined : p.committedStreet,
    potAfter: pot + players.reduce((s, pl) => s + pl.committedStreet, 0),
  };
  log.push(logEntry);

  // 次のアクター決定
  const activePlayers = players.filter((pl) => pl.status === 'active');
  const activeCount = activePlayers.length;

  // active が1人以下 → ハンド終了か全員allin
  let toAct: number | null = null;

  if (activeCount <= 1) {
    // 残り active が1人でも、その1人の拠出が currentBet に満たない場合
    // （他家のオールインレイズに直面等）はコール/フォールドの判断が必要。
    // 満額なら残ストリートは全員 allin 扱いで advanceStreet に委ねる
    const lone = activePlayers[0];
    toAct = lone && lone.committedStreet < currentBet ? lone.id : null;
  } else {
    // 次のアクターを探す
    toAct = nextToActInRound({ ...state, players, currentBet, minRaise }, playerId);
    // ラウンド完了なら null
    if (toAct === null) {
      // double-check: 全員 committedStreet === currentBet かつ hasActed
      const complete = activePlayers.every(
        (pl) => pl.hasActedThisStreet && pl.committedStreet === currentBet,
      );
      if (!complete) {
        // まだ誰かがアクション待ち（例: BBが最初のハンドでUTGだけraise→BB未行動）
        toAct = nextToActInRound({ ...state, players, currentBet, minRaise }, playerId);
      }
    }
  }

  return {
    ...state,
    players,
    pot,
    currentBet,
    minRaise,
    toAct,
    lastAggressor,
    log,
  };
}

/** ストリートを進める。betting round 完了時に呼ぶ。 */
export function advanceStreet(state: GameState): GameState {
  const activePlayers = state.players.filter((p) => p.status === 'active');
  const allinPlayers = state.players.filter((p) => p.status === 'allin');
  const nonFolded = state.players.filter((p) => p.status !== 'folded');

  // 確定ポットにストリート拠出を加算
  const streetTotal = state.players.reduce((s, p) => s + p.committedStreet, 0);
  const newPot = state.pot + streetTotal;

  // ストリート拠出をリセット
  const players = state.players.map((p) => ({
    ...p,
    committedStreet: 0,
    hasActedThisStreet: false,
  }));

  const nextStreet = nextStreetOf(state.street);

  // showdown 以降は resolveShowdown で処理
  if (nextStreet === 'showdown') {
    return resolveShowdown({
      ...state,
      players,
      pot: newPot,
      street: 'showdown',
      toAct: null,
    });
  }

  // フォールド勝ち: active 1人のみ（allin0）
  if (activePlayers.length + allinPlayers.length <= 1) {
    return resolveShowdown({
      ...state,
      players,
      pot: newPot,
      street: nextStreet,
      toAct: null,
    });
  }

  // 全員 allin（active 0）またはactive 1人+allin複数 → ランナウト
  if (activePlayers.length === 0 || (activePlayers.length === 1 && allinPlayers.length > 0)) {
    return runOut({
      ...state,
      players,
      pot: newPot,
      street: nextStreet,
      currentBet: 0,
      minRaise: state.config.bb,
      toAct: null,
    });
  }

  // ボードを配る
  let newDeck = state.deck;
  let newBoard = [...state.board];

  if (nextStreet === 'flop') {
    const [dealt, rest] = dealCards(newDeck, 3);
    newBoard = dealt;
    newDeck = rest;
  } else if (nextStreet === 'turn' || nextStreet === 'river') {
    const [dealt, rest] = dealCards(newDeck, 1);
    newBoard = [...newBoard, dealt[0]];
    newDeck = rest;
  }

  const firstToAct = postflopFirstToAct(state.buttonSeat, players, players.length);

  return {
    ...state,
    players,
    board: newBoard,
    deck: newDeck,
    street: nextStreet,
    pot: newPot,
    currentBet: 0,
    minRaise: state.config.bb,
    toAct: firstToAct,
    lastAggressor: null,
  };
}

/** 残ストリートを一気に配ってショーダウンへ進める。 */
function runOut(state: GameState): GameState {
  let current = state;

  while (current.street !== 'showdown') {
    const nextS = nextStreetOf(current.street);
    let newBoard = [...current.board];
    let newDeck = current.deck;

    if (nextS === 'flop' && newBoard.length === 0) {
      const [dealt, rest] = dealCards(newDeck, 3);
      newBoard = dealt;
      newDeck = rest;
    } else if (nextS === 'turn' && newBoard.length === 3) {
      const [dealt, rest] = dealCards(newDeck, 1);
      newBoard = [...newBoard, dealt[0]];
      newDeck = rest;
    } else if (nextS === 'river' && newBoard.length === 4) {
      const [dealt, rest] = dealCards(newDeck, 1);
      newBoard = [...newBoard, dealt[0]];
      newDeck = rest;
    } else if (nextS === 'showdown') {
      return resolveShowdown({ ...current, board: newBoard, deck: newDeck, street: 'showdown', toAct: null });
    }

    current = { ...current, board: newBoard, deck: newDeck, street: nextS };
  }

  return resolveShowdown(current);
}

/** ショーダウン判定 + ポット分配 + result セット。 */
export function resolveShowdown(state: GameState): GameState {
  const nonFolded = state.players.filter((p) => p.status !== 'folded');

  // 現ストリートの未確定拠出もポットに加算
  const streetTotal = state.players.reduce((s, p) => s + p.committedStreet, 0);
  let pot = state.pot + streetTotal;

  // players の committedTotal を最終状態に反映
  let players = state.players.map((p) => ({
    ...p,
    committedTotal: p.committedTotal, // already updated by applyAction
    committedStreet: 0,
  }));

  // uncalled bet の返還: 全プレイヤー(fold済み含む)の committedTotal を比較し、最大拠出額が
  // 2番目の拠出額を上回る分は「誰にもコールされなかった」超過分としてポットから除外し、
  // 拠出者本人へそのまま返す。これをしないと buildPots が eligible=拠出者1人だけのポット層を
  // 作ってしまい、その層が distributePots 経由で「勝ち分」として result.winners に載ってしまう
  // （敗者でも uncalled 分の返還だけで winners に名前が出るバグ）。
  const byCommitted = [...players].sort((a, b) => b.committedTotal - a.committedTotal);
  const maxCommitted = byCommitted[0]?.committedTotal ?? 0;
  const secondCommitted = byCommitted[1]?.committedTotal ?? 0;
  const refund = maxCommitted - secondCommitted;
  if (refund > 0) {
    const topId = byCommitted[0].id;
    players = players.map((p) =>
      p.id === topId
        ? { ...p, stack: p.stack + refund, committedTotal: p.committedTotal - refund }
        : p,
    );
    pot -= refund;
  }

  // ボードを完成させる（runOut 経由でなく直接呼ばれた場合）
  let board = [...state.board];
  let deck = [...state.deck];
  while (board.length < 5 && nonFolded.length > 1) {
    const [dealt, rest] = dealCards(deck, 1);
    board.push(dealt[0]);
    deck = rest;
  }

  // フォールド勝ち（active 1人）
  if (nonFolded.length === 1) {
    const winner = nonFolded[0];
    const updatedPlayers = players.map((p) =>
      p.id === winner.id ? { ...p, stack: p.stack + pot } : p,
    );
    return {
      ...state,
      players: updatedPlayers,
      board,
      deck,
      street: 'showdown',
      pot: 0,
      toAct: null,
      result: {
        winners: [{ playerId: winner.id, amount: pot }],
        shown: [],
        board,
        endedAtStreet: state.street,
      },
    };
  }

  const { winners, shown } = evaluateShowdown(players, board);

  // スタックに獲得分を加算
  const updatedPlayers = players.map((p) => {
    const win = winners.find((w) => w.playerId === p.id);
    return win ? { ...p, stack: p.stack + win.amount } : p;
  });

  return {
    ...state,
    players: updatedPlayers,
    board,
    deck,
    street: 'showdown',
    pot: 0,
    toAct: null,
    result: {
      winners,
      shown,
      board,
      endedAtStreet: state.street,
    },
  };
}

function nextStreetOf(street: Street): Street {
  switch (street) {
    case 'preflop': return 'flop';
    case 'flop': return 'turn';
    case 'turn': return 'river';
    case 'river': return 'showdown';
    default: return 'showdown';
  }
}
