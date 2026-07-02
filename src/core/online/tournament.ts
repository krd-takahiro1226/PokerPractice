import type { GameConfig, GameState } from '../game/types';
import type { BlindLevel } from '../game/session';

export type TournamentConfig = {
  startingStack: number;
  blindLevels: BlindLevel[];
  handsPerLevel: number;
  difficulty?: GameConfig['difficulty'];
};

export type TournamentConfigInput = Partial<TournamentConfig>;

export type OnlinePlayer = {
  uid: string;
  displayName: string;
  seat: number;
  stack: number;
  status: 'playing' | 'busted' | 'left';
  finishRank: number | null;
  bustedHand: number | null;
  // hand-by-hand post-hand stack history for a result-screen LineChart.
  // startTournament initializes to [startingStack]; applyHandResult appends this hand's
  // post-hand stack for every participant (winners and newly-busted alike).
  stackCurve: number[];
};

export type TournamentState = {
  config: TournamentConfig;
  players: OnlinePlayer[]; // seat-ascending order
  handNumber: number; // 0 = not started
  currentLevel: number; // index into blindLevels
  buttonUid: string | null; // rotates among survivors
  status: 'lobby' | 'playing' | 'finished';
  winnerUid: string | null;
};

export type HandSetup = {
  uids: string[]; // seats for this hand, index i -> engine seat i
  seatStacks: number[]; // same order as uids
  buttonSeat: number; // always 0 (see rationale below)
  config: GameConfig; // reflects current blind level
};

export function startTournament(
  seats: { uid: string; displayName: string; seat: number }[],
  config: TournamentConfig,
): TournamentState {
  const players: OnlinePlayer[] = [...seats]
    .sort((a, b) => a.seat - b.seat)
    .map((s) => ({
      uid: s.uid,
      displayName: s.displayName,
      seat: s.seat,
      stack: config.startingStack,
      status: 'playing',
      finishRank: null,
      bustedHand: null,
      stackCurve: [config.startingStack],
    }));

  return {
    config,
    players,
    handNumber: 0,
    currentLevel: 0,
    buttonUid: players.length > 0 ? players[0].uid : null,
    status: 'playing',
    winnerUid: null,
  };
}

export function livePlayers(t: TournamentState): OnlinePlayer[] {
  return t.players
    .filter((p) => p.status === 'playing' && p.stack > 0)
    .sort((a, b) => a.seat - b.seat);
}

export function setupHand(t: TournamentState): HandSetup {
  const live = livePlayers(t);
  let buttonIdx = live.findIndex((p) => p.uid === t.buttonUid);
  if (buttonIdx < 0) buttonIdx = 0;

  const ordered = [...live.slice(buttonIdx), ...live.slice(0, buttonIdx)];
  const uids = ordered.map((p) => p.uid);
  const seatStacks = ordered.map((p) => p.stack);

  const level = t.config.blindLevels[t.currentLevel];
  const config: GameConfig = {
    difficulty: t.config.difficulty ?? 'normal',
    mode: 'tournament',
    startingStack: t.config.startingStack,
    sb: level.sb,
    bb: level.bb,
    ante: level.ante,
  };

  return { uids, seatStacks, buttonSeat: 0, config };
}

/** 生存者の中で seat 昇順・ラップアラウンドで fromSeat の次を探す。生存者0人なら null。 */
function nextButtonUid(fromSeat: number, survivors: OnlinePlayer[]): string | null {
  if (survivors.length === 0) return null;
  const sorted = [...survivors].sort((a, b) => a.seat - b.seat);
  const next = sorted.find((p) => p.seat > fromSeat);
  return (next ?? sorted[0]).uid;
}

export function applyHandResult(
  t: TournamentState,
  ended: GameState,
  uids: string[],
): TournamentState {
  const handNumber = t.handNumber + 1;

  // 更新前の(手前の)スタックをタイブレーク用に退避
  const preHandStack = new Map<string, number>();
  for (const p of t.players) {
    if (uids.includes(p.uid)) preHandStack.set(p.uid, p.stack);
  }

  const buttonSeatBefore =
    t.players.find((p) => p.uid === t.buttonUid)?.seat ?? -1;

  let players = t.players.map((p) => {
    const idx = uids.indexOf(p.uid);
    // ハンド中に left 化したプレイヤーは markLeft が stack=0/stackCurve 終端(0)を確定済み。
    // ここで ended の値を書き戻すと「バスト後は積まない」規則が破れるため playing のみ反映する。
    if (idx < 0 || p.status !== 'playing') return p;
    const newStack = ended.players[idx].stack;
    return { ...p, stack: newStack, stackCurve: [...p.stackCurve, newStack] };
  });

  // 今ハンドで飛んだ(bust)プレイヤーを検出
  const busting = players.filter(
    (p) => uids.includes(p.uid) && p.status === 'playing' && p.stack <= 0,
  );

  const totalPlayers = t.players.length;
  const alreadyDone = t.players.filter((p) => p.status !== 'playing').length;
  const k = busting.length;
  const survivorsAfterThisHand = totalPlayers - alreadyDone - k;

  if (k > 0) {
    const sorted = [...busting].sort((a, b) => {
      const aPre = preHandStack.get(a.uid) ?? 0;
      const bPre = preHandStack.get(b.uid) ?? 0;
      if (bPre !== aPre) return bPre - aPre; // pre-hand stack DESC
      return a.seat - b.seat; // seat ASC
    });
    const bustUids = new Set(sorted.map((p) => p.uid));
    const rankMap = new Map<string, number>();
    // 同時バスト内では pre-hand stack が大きいほど良い順位(小さい番号)。
    // sorted は (pre-hand stack DESC, seat ASC) なので i=0 が最大スタック/最若席。
    sorted.forEach((p, i) => {
      rankMap.set(p.uid, survivorsAfterThisHand + 1 + i);
    });

    players = players.map((p) => {
      if (!bustUids.has(p.uid)) return p;
      return {
        ...p,
        status: 'busted' as const,
        finishRank: rankMap.get(p.uid) ?? null,
        bustedHand: handNumber,
      };
    });
  }

  let currentLevel = t.currentLevel;
  if (
    t.config.handsPerLevel > 0 &&
    handNumber % t.config.handsPerLevel === 0 &&
    currentLevel < t.config.blindLevels.length - 1
  ) {
    currentLevel += 1;
  }

  const survivors = players.filter((p) => p.status === 'playing');
  let buttonUid = nextButtonUid(buttonSeatBefore, survivors);

  let status = t.status;
  let winnerUid = t.winnerUid;
  if (survivors.length === 1) {
    const winner = survivors[0];
    players = players.map((p) =>
      p.uid === winner.uid ? { ...p, finishRank: 1 } : p,
    );
    status = 'finished';
    winnerUid = winner.uid;
    buttonUid = winner.uid;
  } else if (survivors.length === 0) {
    status = 'finished';
    winnerUid = null;
  }

  return {
    ...t,
    players,
    handNumber,
    currentLevel,
    buttonUid,
    status,
    winnerUid,
  };
}

export function markLeft(t: TournamentState, uid: string): TournamentState {
  const player = t.players.find((p) => p.uid === uid);
  if (!player || player.status !== 'playing') return t;

  const totalPlayingBefore = t.players.filter((p) => p.status === 'playing').length;
  const survivorsAfterThisHand = totalPlayingBefore - 1;
  const finishRank = survivorsAfterThisHand + 1;

  let players = t.players.map((p) =>
    p.uid === uid
      ? {
          ...p,
          status: 'left' as const,
          stack: 0,
          stackCurve: [...p.stackCurve, 0],
          finishRank,
          bustedHand: t.handNumber,
        }
      : p,
  );

  const buttonSeatBefore =
    t.players.find((p) => p.uid === t.buttonUid)?.seat ?? -1;

  const survivors = players.filter((p) => p.status === 'playing');
  let buttonUid = nextButtonUid(buttonSeatBefore, survivors);

  let status = t.status;
  let winnerUid = t.winnerUid;
  if (survivors.length === 1) {
    const winner = survivors[0];
    players = players.map((p) =>
      p.uid === winner.uid ? { ...p, finishRank: 1 } : p,
    );
    status = 'finished';
    winnerUid = winner.uid;
    buttonUid = winner.uid;
  } else if (survivors.length === 0) {
    status = 'finished';
    winnerUid = null;
  }

  return {
    ...t,
    players,
    buttonUid,
    status,
    winnerUid,
  };
}

export function canContinue(t: TournamentState): boolean {
  return t.status === 'playing' && livePlayers(t).length >= 2;
}

export function standings(t: TournamentState): OnlinePlayer[] {
  return [...t.players].sort((a, b) => {
    if (a.finishRank !== null && b.finishRank !== null) {
      return a.finishRank - b.finishRank;
    }
    if (a.finishRank !== null) return -1;
    if (b.finishRank !== null) return 1;
    if (b.stack !== a.stack) return b.stack - a.stack;
    return a.seat - b.seat;
  });
}
