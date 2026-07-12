import { describe, it, expect } from 'vitest';
import {
  startSession,
  configForHand,
  commitHandResult,
  canContinue,
  pruneBustedSeats,
  DEFAULT_TOURNAMENT_LEVELS,
  DEFAULT_HANDS_PER_LEVEL,
  CASH_LEVEL_ANTE,
  CASH_LEVEL_NOANTE,
  type SessionConfig,
} from './session';
import { startHand, advanceStreet, resolveShowdown } from './engine';
import type { GameState } from './types';

// 決定論的 RNG
function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

const TOURNAMENT_CONFIG: SessionConfig = {
  format: 'tournament',
  mode: 'tournament',
  difficulty: 'normal',
  startingStack: 100,
  blindLevels: DEFAULT_TOURNAMENT_LEVELS,
  handsPerLevel: DEFAULT_HANDS_PER_LEVEL,
};

const CASH_CONFIG: SessionConfig = {
  format: 'cash',
  mode: 'cash-ante',
  difficulty: 'normal',
  startingStack: 100,
  blindLevels: [CASH_LEVEL_ANTE],
  handsPerLevel: Number.POSITIVE_INFINITY,
};

/** GameState を showdown まで進める（即フォールド: UTG以外全員フォールドし、UTGが勝つ）。 */
function runToShowdown(s: SessionState_): GameState {
  const { session } = s;
  const cfg = { ...configForHand(session), rng: makeRng(42) };
  let game = startHand(null, cfg, session.seatStacks);

  // 全プレイヤーが fold するまで強制 fold（UTGのみ勝ち残る）
  // ただし resolveShowdown を直接呼ぶ簡易版として game を showdown 相当にする
  // ここでは直接 resolveShowdown を呼んで各 player.stack を操作する
  return resolveShowdown(game);
}

// SessionState の型をローカルで短縮
type SessionState_ = { session: ReturnType<typeof startSession> };

// ─── テスト 1: startSession ────────────────────────────────────────────────────

describe('startSession', () => {
  it('全6席が startingStack、stackCurve=[startingStack]、status=active', () => {
    const session = startSession(TOURNAMENT_CONFIG);
    expect(session.seatStacks).toEqual(Array(6).fill(100));
    expect(session.stackCurve).toEqual([100]);
    expect(session.status).toBe('active');
    expect(session.handNumber).toBe(0);
    expect(session.currentLevel).toBe(0);
  });

  it('playerCount 省略時は6席になる', () => {
    const session = startSession(TOURNAMENT_CONFIG);
    expect(session.seatStacks).toHaveLength(6);
  });

  it('playerCount 指定時は seatStacks の長さが一致する', () => {
    const session = startSession({ ...TOURNAMENT_CONFIG, playerCount: 3 });
    expect(session.seatStacks).toEqual(Array(3).fill(100));
  });
});

// ─── テスト 2: commitHandResult ────────────────────────────────────────────────

describe('commitHandResult', () => {
  it('ended の各 player.stack が seatStacks に反映、stackCurve に seat0 が追記、handNumber+1', () => {
    const session = startSession(TOURNAMENT_CONFIG);
    const cfg = { ...configForHand(session), rng: makeRng(42) };
    const game = startHand(null, cfg, session.seatStacks);
    const ended = resolveShowdown(game);

    const next = commitHandResult(session, ended);
    expect(next.handNumber).toBe(1);
    expect(next.seatStacks).toEqual(ended.players.map((p) => p.stack));
    expect(next.stackCurve).toHaveLength(2);
    expect(next.stackCurve[1]).toBe(ended.players[0].stack);
  });
});

// ─── テスト 3: レベルアップ ────────────────────────────────────────────────────

describe('レベルアップ（tournament, handsPerLevel=2）', () => {
  it('2ハンド commit 後に currentLevel=1、configForHand の bb が level2 の値', () => {
    const cfg: SessionConfig = {
      ...TOURNAMENT_CONFIG,
      handsPerLevel: 2,
    };
    let session = startSession(cfg);

    // 1ハンド目
    const game1 = resolveShowdown(startHand(null, configForHand(session), session.seatStacks));
    session = commitHandResult(session, game1);
    expect(session.currentLevel).toBe(0); // まだ上がらない

    // 2ハンド目
    const game2 = resolveShowdown(startHand(game1, configForHand(session), session.seatStacks));
    session = commitHandResult(session, game2);
    expect(session.currentLevel).toBe(1); // レベルアップ

    const handCfg = configForHand(session);
    expect(handCfg.bb).toBe(DEFAULT_TOURNAMENT_LEVELS[1].bb);
  });
});

// ─── テスト 4: bust 判定 ────────────────────────────────────────────────────────

describe('bust 判定', () => {
  it('seat0.stack=0 の ended を commit → status=bust、canContinue=false', () => {
    const session = startSession(TOURNAMENT_CONFIG);
    const cfg = { ...configForHand(session), rng: makeRng(42) };
    let game = startHand(null, cfg, session.seatStacks);
    game = resolveShowdown(game);

    // ヒーローのスタックを強制的に0にする
    const modifiedGame: GameState = {
      ...game,
      players: game.players.map((p) =>
        p.id === 0 ? { ...p, stack: 0 } : p,
      ),
    };

    const next = commitHandResult(session, modifiedGame);
    expect(next.status).toBe('bust');
    expect(canContinue(next)).toBe(false);
  });
});

// ─── テスト 5: win 判定 ────────────────────────────────────────────────────────

describe('win 判定', () => {
  it('seat1..5 全 stack=0 の ended → status=win', () => {
    const session = startSession(TOURNAMENT_CONFIG);
    const cfg = { ...configForHand(session), rng: makeRng(42) };
    let game = startHand(null, cfg, session.seatStacks);
    game = resolveShowdown(game);

    // 他全席のスタックを強制的に0にする
    const totalChips = game.players.reduce((s, p) => s + p.stack, 0);
    const modifiedGame: GameState = {
      ...game,
      players: game.players.map((p) =>
        p.id === 0
          ? { ...p, stack: totalChips }  // ヒーローが全チップ
          : { ...p, stack: 0 },
      ),
    };

    const next = commitHandResult(session, modifiedGame);
    expect(next.status).toBe('win');
  });
});

// ─── テスト 6: cash ────────────────────────────────────────────────────────────

describe('cash モード', () => {
  it('複数ハンド commit しても currentLevel が動かない、quit まで active', () => {
    let session = startSession(CASH_CONFIG);

    for (let i = 0; i < 15; i++) {
      const cfg = { ...configForHand(session), rng: makeRng(i) };
      const game = resolveShowdown(startHand(null, cfg, session.seatStacks));
      session = commitHandResult(session, game);
    }

    expect(session.currentLevel).toBe(0);
    // ヒーローのスタックが >0 なら active のまま
    if (session.seatStacks[0] > 0) {
      expect(session.status).toBe('active');
    }
  });

  it('cash でヒーローがスタック0になると bust', () => {
    let session = startSession(CASH_CONFIG);
    const cfg = { ...configForHand(session), rng: makeRng(42) };
    const game = resolveShowdown(startHand(null, cfg, session.seatStacks));

    const modifiedGame: GameState = {
      ...game,
      players: game.players.map((p) =>
        p.id === 0 ? { ...p, stack: 0 } : p,
      ),
    };

    const next = commitHandResult(session, modifiedGame);
    expect(next.status).toBe('bust');
  });
});

// ─── テスト: ゾンビ席除去（VS-1） ───────────────────────────────────────────────

describe('ゾンビ席除去', () => {
  it('非ヒーロー席がバストすると次ハンドの seatStacks から除外される', () => {
    const session = startSession(TOURNAMENT_CONFIG);
    const cfg = { ...configForHand(session), rng: makeRng(42) };
    const game = startHand(null, cfg, session.seatStacks);
    const ended = resolveShowdown(game);

    // seat2, seat4（非ヒーロー）を強制バスト。他は正のスタックを維持。
    const modifiedGame: GameState = {
      ...ended,
      players: ended.players.map((p) => {
        if (p.id === 2 || p.id === 4) return { ...p, stack: 0 };
        if (p.stack <= 0) return { ...p, stack: 1 }; // 他は正のスタックを維持
        return p;
      }),
    };

    const next = commitHandResult(session, modifiedGame);

    expect(next.status).toBe('active');
    expect(next.seatStacks).toHaveLength(4);
    expect(next.seatStacks[0]).toBe(modifiedGame.players[0].stack);
    expect(next.seatStacks).not.toContain(0);
  });

  it('縮小したテーブルでも新ハンドで実ブラインドが課される（BBが0スタック席に当たらない）', () => {
    const session = startSession(TOURNAMENT_CONFIG);
    const cfg = { ...configForHand(session), rng: makeRng(42) };
    const game = startHand(null, cfg, session.seatStacks);
    const ended = resolveShowdown(game);

    const modifiedGame: GameState = {
      ...ended,
      players: ended.players.map((p) => {
        if (p.id === 2 || p.id === 4) return { ...p, stack: 0 };
        if (p.stack <= 0) return { ...p, stack: 1 };
        return p;
      }),
    };

    const next = commitHandResult(session, modifiedGame);

    const handCfg = configForHand(next);
    const newGame = startHand(null, handCfg, next.seatStacks);

    expect(newGame.players).toHaveLength(4);
    expect(newGame.currentBet).toBe(handCfg.bb);
  });

  it('SB/BB席が0スタックだと startHand が例外を投げる', () => {
    const session = startSession(TOURNAMENT_CONFIG);
    const cfg = configForHand(session);

    expect(() => startHand(null, cfg, [100, 0, 100, 100, 100, 100])).toThrow();
  });

  it('pruneBustedSeats: 旧形式(ゾンビ席入り)の seatStacks を正規化し startHand できる', () => {
    // ゾンビ席除外の導入前に保存されたセッションの復元経路(resume)を想定
    const pruned = pruneBustedSeats([50, 0, 30, 0, 20, 0]);

    expect(pruned).toEqual([50, 30, 20]);

    const session = startSession(TOURNAMENT_CONFIG);
    const cfg = configForHand(session);
    expect(() => startHand(null, cfg, pruned)).not.toThrow();
  });

  it('pruneBustedSeats: ヒーロー(index0)は stack 0 でも残す', () => {
    expect(pruneBustedSeats([0, 10, 0, 20])).toEqual([0, 10, 20]);
  });
});

// ─── テスト: cash win 判定（VS-2） ──────────────────────────────────────────────

describe('cash win 判定', () => {
  it('cash で他全席スタック0 → status=win、canContinue=false', () => {
    const session = startSession(CASH_CONFIG);
    const cfg = { ...configForHand(session), rng: makeRng(42) };
    let game = startHand(null, cfg, session.seatStacks);
    game = resolveShowdown(game);

    const totalChips = game.players.reduce((s, p) => s + p.stack, 0);
    const modifiedGame: GameState = {
      ...game,
      players: game.players.map((p) =>
        p.id === 0
          ? { ...p, stack: totalChips }
          : { ...p, stack: 0 },
      ),
    };

    const next = commitHandResult(session, modifiedGame);
    expect(next.status).toBe('win');
    expect(canContinue(next)).toBe(false);
  });
});

// ─── テスト 7: チップ保存性 ────────────────────────────────────────────────────

describe('チップ保存性', () => {
  it('セッション内で Σ seatStacks（ゼロサム）が保持される', () => {
    let session = startSession(TOURNAMENT_CONFIG);
    const totalStart = session.seatStacks.reduce((s, v) => s + v, 0);

    // 数ハンドプレイして総チップが変わらないことを確認
    for (let i = 0; i < 5 && canContinue(session); i++) {
      const cfg = { ...configForHand(session), rng: makeRng(i * 7) };
      const game = resolveShowdown(startHand(null, cfg, session.seatStacks));
      session = commitHandResult(session, game);

      const total = session.seatStacks.reduce((s, v) => s + v, 0);
      // 浮動小数点誤差を許容して総チップが一定であることを確認
      expect(Math.abs(total - totalStart)).toBeLessThan(0.001);
    }
  });
});
