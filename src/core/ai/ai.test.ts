import { describe, it, expect } from 'vitest';
import { decideCpu } from './index';
import { startHand, legalActions, applyAction, advanceStreet } from '../game/engine';
import type { GameConfig, GameState } from '../game/types';

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

function freshConfig(seed = 42, difficulty: GameConfig['difficulty'] = 'normal'): GameConfig {
  return {
    difficulty,
    mode: 'tournament',
    startingStack: 100,
    sb: 0.5,
    bb: 1,
    ante: 0,
    rng: makeRng(seed),
  };
}

/** ハンドを最後まで自動進行させる（CPU全員）。チップ保存性を検証するために使う。 */
function runHandToCompletion(state: GameState): GameState {
  let safetyCounter = 0;
  const MAX_ACTIONS = 500; // 無限ループ防止

  while (state.street !== 'showdown' && safetyCounter < MAX_ACTIONS) {
    safetyCounter++;
    if (state.toAct !== null) {
      const action = decideCpu(state, state.toAct);
      state = applyAction(state, state.toAct, action);
    } else {
      state = advanceStreet(state);
    }
  }

  return state;
}

describe('decideCpu - 合法アクションのプロパティテスト', () => {
  it('ランダム局面で常に合法アクションを返す（プリフロップ・normal）', () => {
    for (let seed = 0; seed < 50; seed++) {
      let state = startHand(null, freshConfig(seed));
      let actionCount = 0;

      while (state.toAct !== null && state.street === 'preflop' && actionCount < 20) {
        actionCount++;
        const pid = state.toAct;
        const action = decideCpu(state, pid);
        const legal = legalActions(state, pid);

        // アクションが合法かチェック
        if (action.type === 'check') {
          expect(legal.canCheck, `seed=${seed} check illegal`).toBe(true);
        } else if (action.type === 'call') {
          expect(legal.canCall, `seed=${seed} call illegal`).toBe(true);
        } else if (action.type === 'bet') {
          expect(legal.canBet, `seed=${seed} bet illegal`).toBe(true);
          expect(action.amount).toBeGreaterThanOrEqual(legal.minBetTo - 0.001);
          expect(action.amount).toBeLessThanOrEqual(legal.maxBetTo + 0.001);
        } else if (action.type === 'raise') {
          expect(legal.canRaise, `seed=${seed} raise illegal`).toBe(true);
          expect(action.amount).toBeGreaterThanOrEqual(legal.minBetTo - 0.001);
          expect(action.amount).toBeLessThanOrEqual(legal.maxBetTo + 0.001);
        }
        // fold は常に合法

        state = applyAction(state, pid, action);
      }
    }
  });

  it('ランダム局面で常に合法アクションを返す（ポストフロップ・全難易度）', () => {
    const difficulties: GameConfig['difficulty'][] = ['easy', 'normal', 'hard'];
    for (const diff of difficulties) {
      for (let seed = 0; seed < 20; seed++) {
        let state = startHand(null, freshConfig(seed * 100 + 1, diff));
        // プリフロップを素早く終わらせる
        let pfCount = 0;
        while (state.toAct !== null && state.street === 'preflop' && pfCount < 20) {
          pfCount++;
          state = applyAction(state, state.toAct, decideCpu(state, state.toAct));
        }
        if (state.toAct === null && state.street === 'preflop') {
          state = advanceStreet(state);
        }

        if (state.street === 'showdown') continue;

        // フロップで各アクターを確認
        let actionCount = 0;
        while (state.toAct !== null && state.street !== 'showdown' && actionCount < 30) {
          actionCount++;
          const pid = state.toAct;
          const action = decideCpu(state, pid);
          const legal = legalActions(state, pid);

          if (action.type === 'check') {
            expect(legal.canCheck, `diff=${diff} seed=${seed} check illegal`).toBe(true);
          } else if (action.type === 'call') {
            expect(legal.canCall, `diff=${diff} seed=${seed} call illegal`).toBe(true);
          } else if (action.type === 'bet') {
            expect(legal.canBet, `diff=${diff} seed=${seed} bet illegal`).toBe(true);
          } else if (action.type === 'raise') {
            expect(legal.canRaise, `diff=${diff} seed=${seed} raise illegal`).toBe(true);
          }

          state = applyAction(state, pid, action);
        }
      }
    }
  });

  it('例外を投げない（フェイルセーフ）', () => {
    for (let seed = 0; seed < 30; seed++) {
      const state = startHand(null, freshConfig(seed * 7));
      if (state.toAct !== null) {
        expect(() => decideCpu(state, state.toAct!)).not.toThrow();
      }
    }
  });
});

describe('decideCpu - ふつうAIの基本動作', () => {
  it('プレミアムハンドでオープン', () => {
    // AA でのUTGアクション: openするはず
    // シードを試行して AA が来るまで探す
    let openCount = 0;
    let trials = 0;
    for (let seed = 0; seed < 200; seed++) {
      const state = startHand(null, freshConfig(seed, 'normal'));
      const utg = state.players.find((p) => p.pos === 'UTG')!;
      if (!utg.hole) continue;

      const hc = `${utg.hole[0][0]}${utg.hole[1][0]}`;
      // AA か KK か QQ
      const isPremium = utg.hole[0][0] === utg.hole[1][0] &&
        ['A', 'K', 'Q', 'J'].includes(utg.hole[0][0]);
      if (!isPremium) continue;

      trials++;
      if (state.toAct !== utg.id) continue;

      const action = decideCpu(state, utg.id);
      if (action.type === 'raise' || action.type === 'bet') openCount++;
      if (trials >= 20) break;
    }
    // プレミアムで十分高頻度でオープンする
    if (trials > 0) {
      expect(openCount / trials).toBeGreaterThan(0.5);
    }
  });
});

describe('チップ保存性テスト（CPU 6人自動対戦）', () => {
  it('200ハンド完走後もチップ総量が保存される', () => {
    const config = freshConfig(12345, 'normal');
    let state: GameState | null = null;
    const startTotal = config.startingStack * 6;

    for (let hand = 0; hand < 200; hand++) {
      const handConfig: GameConfig = {
        ...config,
        rng: makeRng(hand * 31 + 7),
      };
      state = startHand(state, handConfig);
      state = runHandToCompletion(state);

      // ハンド終了後のチップ総量チェック
      const total = state.players.reduce((s, p) => s + p.stack, 0);
      // startingStack * 6 からの許容誤差（浮動小数点）
      expect(total).toBeCloseTo(startTotal, 3);
    }

    // 最終状態でresultが設定されている
    expect(state!.street).toBe('showdown');
    expect(state!.result).not.toBeNull();
  });

  it('50ハンド: 全難易度でクラッシュなく完走する', () => {
    const difficulties: GameConfig['difficulty'][] = ['easy', 'normal', 'hard'];
    for (const diff of difficulties) {
      let state: GameState | null = null;
      for (let hand = 0; hand < 50; hand++) {
        const handConfig: GameConfig = {
          difficulty: diff,
          mode: 'tournament',
          startingStack: 100,
          sb: 0.5,
          bb: 1,
          ante: 0,
          rng: makeRng(hand * 13 + diff.length),
        };
        state = startHand(state, handConfig);
        expect(() => {
          state = runHandToCompletion(state!);
        }).not.toThrow();
        expect(state!.street).toBe('showdown');
      }
    }
  });
});

describe('decideCpu - モード対応', () => {
  it('cash-noante モードでも常に合法アクションを返す', () => {
    for (let seed = 0; seed < 30; seed++) {
      const config: GameConfig = {
        difficulty: 'normal',
        mode: 'cash-noante',
        startingStack: 100,
        sb: 0.5,
        bb: 1,
        ante: 0,
        rng: makeRng(seed),
      };
      let state = startHand(null, config);
      let actionCount = 0;

      while (state.toAct !== null && state.street === 'preflop' && actionCount < 20) {
        actionCount++;
        const pid = state.toAct;
        const action = decideCpu(state, pid);
        const legal = legalActions(state, pid);

        if (action.type === 'check') {
          expect(legal.canCheck, `seed=${seed} check illegal`).toBe(true);
        } else if (action.type === 'call') {
          expect(legal.canCall, `seed=${seed} call illegal`).toBe(true);
        } else if (action.type === 'raise') {
          expect(legal.canRaise, `seed=${seed} raise illegal`).toBe(true);
        }

        state = applyAction(state, pid, action);
      }
    }
  });
});
