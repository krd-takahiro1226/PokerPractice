import { describe, it, expect } from 'vitest';
import {
  startTournament,
  livePlayers,
  setupHand,
  applyHandResult,
  markLeft,
  canContinue,
  standings,
  type TournamentConfig,
  type TournamentState,
} from './tournament';
import type { GameState } from '../game/types';

const LEVELS = [
  { sb: 0.5, bb: 1, ante: 1 },
  { sb: 1, bb: 2, ante: 2 },
  { sb: 1.5, bb: 3, ante: 3 },
];

function makeConfig(overrides: Partial<TournamentConfig> = {}): TournamentConfig {
  return {
    startingStack: 100,
    blindLevels: LEVELS,
    handsPerLevel: 10,
    ...overrides,
  };
}

function makeSeats(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    uid: `p${i}`,
    displayName: `Player ${i}`,
    seat: i,
  }));
}

/** ended.players[i].stack のみ参照されるため最小のフィクスチャを作る。 */
function makeEnded(stacks: number[]): GameState {
  return {
    players: stacks.map((stack) => ({ stack })),
  } as unknown as GameState;
}

// ─── テスト1: startTournament ───────────────────────────────────────────────

describe('startTournament', () => {
  it('全員 startingStack、status=playing、button は最若席、handNumber=0、stackCurve初期値', () => {
    const t = startTournament(makeSeats(4), makeConfig());
    expect(t.players.every((p) => p.stack === 100)).toBe(true);
    expect(t.players.every((p) => p.status === 'playing')).toBe(true);
    expect(t.players.every((p) => p.stackCurve.length === 1 && p.stackCurve[0] === 100)).toBe(
      true,
    );
    expect(t.buttonUid).toBe('p0');
    expect(t.handNumber).toBe(0);
    expect(t.currentLevel).toBe(0);
    expect(t.status).toBe('playing');
    expect(t.winnerUid).toBeNull();
  });

  it('players は seat 昇順で格納される', () => {
    const shuffled = [
      { uid: 'p2', displayName: 'P2', seat: 2 },
      { uid: 'p0', displayName: 'P0', seat: 0 },
      { uid: 'p1', displayName: 'P1', seat: 1 },
    ];
    const t = startTournament(shuffled, makeConfig());
    expect(t.players.map((p) => p.uid)).toEqual(['p0', 'p1', 'p2']);
  });
});

// ─── テスト2: setupHand ────────────────────────────────────────────────────

describe('setupHand', () => {
  it('button が uids[0]/seatStacks[0] になり、buttonSeat=0、config が currentLevel を反映', () => {
    const t = startTournament(makeSeats(4), makeConfig());
    const setup = setupHand(t);
    expect(setup.uids[0]).toBe('p0');
    expect(setup.buttonSeat).toBe(0);
    expect(setup.uids).toHaveLength(4);
    expect(setup.seatStacks).toEqual([100, 100, 100, 100]);
    expect(setup.config.mode).toBe('tournament');
    expect(setup.config.sb).toBe(LEVELS[0].sb);
    expect(setup.config.bb).toBe(LEVELS[0].bb);
    expect(setup.config.ante).toBe(LEVELS[0].ante);
  });

  it('currentLevel が進んでいれば config に反映される', () => {
    let t = startTournament(makeSeats(4), makeConfig());
    t = { ...t, currentLevel: 1 };
    const setup = setupHand(t);
    expect(setup.config.sb).toBe(LEVELS[1].sb);
    expect(setup.config.bb).toBe(LEVELS[1].bb);
    expect(setup.config.ante).toBe(LEVELS[1].ante);
  });

  it('button が非0席のとき、そのプレイヤーが uids[0] になり並び替えられる', () => {
    let t = startTournament(makeSeats(4), makeConfig());
    t = { ...t, buttonUid: 'p2' };
    const setup = setupHand(t);
    expect(setup.uids[0]).toBe('p2');
    expect(setup.uids).toEqual(['p2', 'p3', 'p0', 'p1']);
  });
});

// ─── テスト3: applyHandResult 基本動作 ──────────────────────────────────────

describe('applyHandResult', () => {
  it('stack を書き戻し、handNumber をインクリメントし、button を次の生存者に進める', () => {
    const t = startTournament(makeSeats(4), makeConfig());
    const setup = setupHand(t); // uids = [p0, p1, p2, p3]
    const ended = makeEnded([70, 130, 100, 100]);
    const next = applyHandResult(t, ended, setup.uids);

    expect(next.handNumber).toBe(1);
    const byUid = Object.fromEntries(next.players.map((p) => [p.uid, p]));
    expect(byUid.p0.stack).toBe(70);
    expect(byUid.p1.stack).toBe(130);
    expect(byUid.p0.stackCurve).toEqual([100, 70]);
    expect(byUid.p1.stackCurve).toEqual([100, 130]);
    // button (p0, seat0) の次の生存者 = p1 (seat1)
    expect(next.buttonUid).toBe('p1');
  });

  it('バストしたプレイヤーの status/finishRank/bustedHand を設定する', () => {
    const t = startTournament(makeSeats(4), makeConfig());
    const setup = setupHand(t);
    const ended = makeEnded([0, 130, 100, 70]);
    const next = applyHandResult(t, ended, setup.uids);

    const p0 = next.players.find((p) => p.uid === 'p0')!;
    expect(p0.status).toBe('busted');
    expect(p0.bustedHand).toBe(1);
    // 4人中1人バスト: survivorsAfterThisHand = 4-0-1 = 3, rank = 3+1 = 4 (最下位)
    expect(p0.finishRank).toBe(4);
  });

  it('元の TournamentState を変異させない', () => {
    const t = startTournament(makeSeats(4), makeConfig());
    const setup = setupHand(t);
    const ended = makeEnded([70, 130, 100, 100]);
    const before = JSON.parse(JSON.stringify(t));
    applyHandResult(t, ended, setup.uids);
    expect(t).toEqual(before);
  });

  it('参加していないプレイヤーの stackCurve は伸びない', () => {
    const t = startTournament(makeSeats(4), makeConfig());
    // p3 を除いた3人だけのハンド
    const ended = makeEnded([120, 100, 80]);
    const next = applyHandResult(t, ended, ['p0', 'p1', 'p2']);
    const p3 = next.players.find((p) => p.uid === 'p3')!;
    expect(p3.stackCurve).toEqual([100]);
    expect(p3.stack).toBe(100);
  });
});

// ─── テスト4: レベルアップ ───────────────────────────────────────────────────

describe('レベルアップ', () => {
  it('handsPerLevel ハンド経過で currentLevel が上がる', () => {
    let t = startTournament(makeSeats(4), makeConfig({ handsPerLevel: 2 }));
    const setup1 = setupHand(t);
    t = applyHandResult(t, makeEnded([100, 100, 100, 100]), setup1.uids);
    expect(t.currentLevel).toBe(0);

    const setup2 = setupHand(t);
    t = applyHandResult(t, makeEnded([100, 100, 100, 100]), setup2.uids);
    expect(t.currentLevel).toBe(1);
  });
});

// ─── テスト5: 単独優勝 ──────────────────────────────────────────────────────

describe('優勝判定', () => {
  it('残り1人になったら status=finished, winnerUid, finishRank=1 を設定', () => {
    const seats = makeSeats(2);
    const t = startTournament(seats, makeConfig());
    const setup = setupHand(t); // uids = [p0, p1]
    const ended = makeEnded([200, 0]);
    const next = applyHandResult(t, ended, setup.uids);

    expect(next.status).toBe('finished');
    expect(next.winnerUid).toBe('p0');
    const winner = next.players.find((p) => p.uid === 'p0')!;
    expect(winner.finishRank).toBe(1);
    const loser = next.players.find((p) => p.uid === 'p1')!;
    expect(loser.finishRank).toBe(2);
    expect(loser.status).toBe('busted');
  });
});

// ─── テスト6: 同時バストの順位付け ────────────────────────────────────────────

describe('同時バストの finishRank', () => {
  it('pre-hand stack が大きい方が良い順位、同スタックなら席番号が小さい方が良い順位', () => {
    const seats = makeSeats(6);
    let t = startTournament(seats, makeConfig());
    // pre-hand stack を p0=100, p1=100 (同額), 他は据え置き
    const setup = setupHand(t); // uids = [p0..p5]
    // p0, p1 が同時バスト。pre-hand stack は両者とも100(タイ) → 席が若いp0が有利
    const ended = makeEnded([0, 0, 130, 130, 120, 120]);
    const next = applyHandResult(t, ended, setup.uids);

    const p0 = next.players.find((p) => p.uid === 'p0')!;
    const p1 = next.players.find((p) => p.uid === 'p1')!;
    // survivorsAfterThisHand = 6-0-2=4, ranks: 4+1=5 (良い), 4+2=6 (悪い)
    expect(p0.finishRank).toBe(5);
    expect(p1.finishRank).toBe(6);
    expect(p0.finishRank!).toBeLessThan(p1.finishRank!);
  });

  it('pre-hand stack が異なる場合、大きいスタックの方が良い順位になる', () => {
    const seats = [
      { uid: 'a', displayName: 'A', seat: 0 },
      { uid: 'b', displayName: 'B', seat: 1 },
      { uid: 'c', displayName: 'C', seat: 2 },
      { uid: 'd', displayName: 'D', seat: 3 },
    ];
    let t = startTournament(seats, makeConfig());
    // b の pre-hand stack を大きくしておく
    t = {
      ...t,
      players: t.players.map((p) => (p.uid === 'b' ? { ...p, stack: 250 } : p)),
    };
    const setup = setupHand(t); // uids = [a, b, c, d]
    // a (pre=100) と b (pre=250) が同時バスト
    const ended = makeEnded([0, 0, 150, 100]);
    const next = applyHandResult(t, ended, setup.uids);

    const a = next.players.find((p) => p.uid === 'a')!;
    const b = next.players.find((p) => p.uid === 'b')!;
    // survivorsAfterThisHand = 4-0-2=2, ranks: 2+1=3 (良い, bが大きいpre-stack), 2+2=4 (悪い, aが小さいpre-stack)
    expect(b.finishRank).toBe(3);
    expect(a.finishRank).toBe(4);
  });

  it('複数ハンド(同時複数バスト含む)のフルシミュレーションで finishRank は 1..N の重複なし順列になる', () => {
    const seats = makeSeats(6);
    let t = startTournament(seats, makeConfig({ handsPerLevel: 100 }));

    // Hand1: p2, p3 が同時バスト (pre-hand stack 両者100、タイ→席小さい方が有利)
    let setup = setupHand(t);
    t = applyHandResult(t, makeEnded([100, 100, 0, 0, 200, 200]), setup.uids);
    expect(canContinue(t)).toBe(true);

    // 生存者: p0, p1, p4, p5
    // Hand2: p1 が単独バスト
    setup = setupHand(t);
    const stacksByUid2: Record<string, number> = {};
    for (const [i, uid] of setup.uids.entries()) {
      const p = t.players.find((pp) => pp.uid === uid)!;
      stacksByUid2[uid] = p.stack;
      void i;
    }
    const total2 = Object.values(stacksByUid2).reduce((s, v) => s + v, 0);
    const otherUids = setup.uids.filter((u) => u !== 'p1');
    const endedStacks2 = setup.uids.map((uid) =>
      uid === 'p1' ? 0 : total2 / otherUids.length,
    );
    t = applyHandResult(t, makeEnded(endedStacks2), setup.uids);
    expect(canContinue(t)).toBe(true);

    // 生存者3人: p0, p4, p5 のうち1人がバスト
    setup = setupHand(t);
    const bustUid = setup.uids[0];
    const totalRemaining = setup.uids.reduce(
      (s, uid) => s + t.players.find((p) => p.uid === uid)!.stack,
      0,
    );
    const survivorsUids = setup.uids.filter((u) => u !== bustUid);
    const endedStacks3 = setup.uids.map((uid) =>
      uid === bustUid ? 0 : totalRemaining / survivorsUids.length,
    );
    t = applyHandResult(t, makeEnded(endedStacks3), setup.uids);
    expect(canContinue(t)).toBe(true);

    // 生存者2人、決着
    setup = setupHand(t);
    const winnerUidFinal = setup.uids[0];
    const totalFinal = setup.uids.reduce(
      (s, uid) => s + t.players.find((p) => p.uid === uid)!.stack,
      0,
    );
    const endedStacksFinal = setup.uids.map((uid) =>
      uid === winnerUidFinal ? totalFinal : 0,
    );
    t = applyHandResult(t, makeEnded(endedStacksFinal), setup.uids);

    expect(t.status).toBe('finished');
    expect(t.winnerUid).toBe(winnerUidFinal);
    expect(canContinue(t)).toBe(false);

    const ranks = t.players.map((p) => p.finishRank).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6]);
    const champion = t.players.find((p) => p.finishRank === 1)!;
    expect(champion.uid).toBe(winnerUidFinal);
  });
});

// ─── テスト7: markLeft ──────────────────────────────────────────────────────

describe('markLeft', () => {
  it('stack が没収され status=left、finishRank が付与される', () => {
    const t = startTournament(makeSeats(4), makeConfig());
    const next = markLeft(t, 'p2');
    const p2 = next.players.find((p) => p.uid === 'p2')!;
    expect(p2.status).toBe('left');
    expect(p2.stack).toBe(0);
    expect(p2.stackCurve).toEqual([100, 0]);
    // survivorsAfterThisHand = 4-1=3, finishRank = 3+1=4
    expect(p2.finishRank).toBe(4);
    expect(p2.bustedHand).toBe(t.handNumber);
  });

  it('canContinue が生存者数の減少を反映する', () => {
    const t = startTournament(makeSeats(2), makeConfig());
    expect(canContinue(t)).toBe(true);
    const next = markLeft(t, 'p1');
    expect(canContinue(next)).toBe(false);
    expect(next.status).toBe('finished');
    expect(next.winnerUid).toBe('p0');
  });

  it('既に left のプレイヤーへの再呼び出しは同じ参照を返す(冪等性)', () => {
    const t = startTournament(makeSeats(4), makeConfig());
    const once = markLeft(t, 'p1');
    const twice = markLeft(once, 'p1');
    expect(twice).toBe(once);
  });

  it('ハンド中に left したプレイヤーは applyHandResult で stack/stackCurve が上書きされない', () => {
    // ハンド参加中(uids に含まれる)に leave → markLeft → そのハンドが後で確定するケース。
    // markLeft で stackCurve は [100, 0] に終端済み。applyHandResult は left を反映しないこと。
    const t = startTournament(makeSeats(3), makeConfig());
    const left = markLeft(t, 'p1');
    const ended = makeEnded([120, 40, 140]); // p1 は fold 後残り 40 で終わった体
    const after = applyHandResult(left, ended, ['p0', 'p1', 'p2']);
    const p1 = after.players.find((p) => p.uid === 'p1')!;
    expect(p1.stack).toBe(0);
    expect(p1.stackCurve).toEqual([100, 0]);
    expect(p1.status).toBe('left');
    // playing の2人は通常どおり反映される
    expect(after.players.find((p) => p.uid === 'p0')!.stackCurve).toEqual([100, 120]);
    expect(after.players.find((p) => p.uid === 'p2')!.stackCurve).toEqual([100, 140]);
  });
});

// ─── テスト8: チップ保存則 ──────────────────────────────────────────────────

describe('チップ保存則', () => {
  it('各 applyHandResult の後で全プレイヤーの最新 stackCurve 合計が n*startingStack を保つ', () => {
    const n = 4;
    let t = startTournament(makeSeats(n), makeConfig({ handsPerLevel: 100 }));
    const totalChips = n * t.config.startingStack;

    function assertConserved(state: TournamentState) {
      const sum = state.players.reduce(
        (s, p) => s + p.stackCurve[p.stackCurve.length - 1],
        0,
      );
      expect(sum).toBe(totalChips);
    }

    // Hand1: p3 が p1 に一部負ける
    let setup = setupHand(t); // [p0,p1,p2,p3]
    t = applyHandResult(t, makeEnded([90, 130, 100, 80]), setup.uids);
    assertConserved(t);

    // Hand2: p3 が全部失ってバスト
    setup = setupHand(t);
    const stacks = setup.uids.map((uid) => t.players.find((p) => p.uid === uid)!.stack);
    const busterIdx = setup.uids.indexOf('p3');
    const busterStack = stacks[busterIdx];
    const winnerIdx = (busterIdx + 1) % setup.uids.length;
    const newStacks = [...stacks];
    newStacks[busterIdx] = 0;
    newStacks[winnerIdx] += busterStack;
    t = applyHandResult(t, makeEnded(newStacks), setup.uids);
    assertConserved(t);

    // Hand3: 残り3人でチップ移動のみ
    setup = setupHand(t);
    const stacks3 = setup.uids.map((uid) => t.players.find((p) => p.uid === uid)!.stack);
    const moved = [stacks3[0] - 20, stacks3[1] + 20, stacks3[2]];
    t = applyHandResult(t, makeEnded(moved), setup.uids);
    assertConserved(t);
  });
});

// ─── standings ──────────────────────────────────────────────────────────────

describe('standings', () => {
  it('finishRank がある者を昇順で先に、残りは stack 降順→seat 昇順で並べる', () => {
    const t = startTournament(makeSeats(3), makeConfig());
    const withRanks: TournamentState = {
      ...t,
      players: [
        { ...t.players[0], stack: 150, finishRank: null },
        { ...t.players[1], stack: 0, finishRank: 3, status: 'busted' },
        { ...t.players[2], stack: 150, finishRank: null },
      ],
    };
    const result = standings(withRanks);
    expect(result.map((p) => p.uid)).toEqual(['p1', 'p0', 'p2']);
  });
});
