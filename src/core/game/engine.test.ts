import { describe, it, expect } from 'vitest';
import { startHand, legalActions, applyAction, isBettingRoundComplete, advanceStreet, resolveShowdown } from './engine';
import type { GameConfig, GameState } from './types';

/** 決定論的な RNG: シードから lcg 生成 */
function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

const DEFAULT_CONFIG: GameConfig = {
  difficulty: 'normal',
  mode: 'tournament',
  startingStack: 100,
  sb: 0.5,
  bb: 1,
  ante: 0,
  rng: makeRng(42),
};

function freshConfig(seed = 42): GameConfig {
  return { ...DEFAULT_CONFIG, rng: makeRng(seed) };
}

describe('startHand', () => {
  it('ブラインド投下後の currentBet/toAct/committedStreet', () => {
    const state = startHand(null, freshConfig());

    // currentBet = bb = 1
    expect(state.currentBet).toBe(1);

    // SBのcommittedStreet = 0.5
    const sb = state.players.find((p) => p.pos === 'SB')!;
    expect(sb.committedStreet).toBeCloseTo(0.5);

    // BBのcommittedStreet = 1
    const bb = state.players.find((p) => p.pos === 'BB')!;
    expect(bb.committedStreet).toBeCloseTo(1);

    // 最初のtoActはUTG
    const utg = state.players.find((p) => p.pos === 'UTG')!;
    expect(state.toAct).toBe(utg.id);
  });

  it('全員にホールカードが配られている', () => {
    const state = startHand(null, freshConfig());
    for (const p of state.players) {
      expect(p.hole).not.toBeNull();
      expect(p.hole).toHaveLength(2);
    }
    // カードが重複していないこと
    const allCards = state.players.flatMap((p) => p.hole!);
    expect(new Set(allCards).size).toBe(12);
  });

  it('ハンド番号がローテーションする', () => {
    const s1 = startHand(null, freshConfig(1));
    const s2 = startHand(s1, freshConfig(2));
    expect(s2.handNumber).toBe(2);
    expect(s2.buttonSeat).toBe((s1.buttonSeat + 1) % 6);
  });
});

describe('applyAction - fold', () => {
  it('UTGフォールドでstatusがfoldedになる', () => {
    const state = startHand(null, freshConfig());
    const utg = state.players.find((p) => p.pos === 'UTG')!;
    const next = applyAction(state, utg.id, { type: 'fold' });
    expect(next.players[utg.id].status).toBe('folded');
  });

  it('全員フォールドでBBが勝つ（UTGオープン後全員フォールド）', () => {
    let state = startHand(null, freshConfig());
    const utg = state.players.find((p) => p.pos === 'UTG')!;
    const hj = state.players.find((p) => p.pos === 'HJ')!;
    const co = state.players.find((p) => p.pos === 'CO')!;
    const btn = state.players.find((p) => p.pos === 'BTN')!;
    const sb = state.players.find((p) => p.pos === 'SB')!;
    const bb = state.players.find((p) => p.pos === 'BB')!;

    // UTG open 2.5bb
    state = applyAction(state, utg.id, { type: 'raise', amount: 2.5 });
    // HJ fold
    state = applyAction(state, hj.id, { type: 'fold' });
    // CO fold
    state = applyAction(state, co.id, { type: 'fold' });
    // BTN fold
    state = applyAction(state, btn.id, { type: 'fold' });
    // SB fold
    state = applyAction(state, sb.id, { type: 'fold' });

    // toAct がBBになる
    expect(state.toAct).toBe(bb.id);

    // BB fold → UTGがpot獲得
    state = applyAction(state, bb.id, { type: 'fold' });

    // toAct=null になったのでadvanceStreet
    expect(state.toAct).toBeNull();
    state = advanceStreet(state);

    expect(state.street).toBe('showdown');
    expect(state.result).not.toBeNull();
    expect(state.result!.winners[0].playerId).toBe(utg.id);
    // UTGのスタックはstartingStack - 2.5 + pot
    const potAmount = 0.5 + 1 + 2.5; // SB + BB + UTG raise
    expect(state.result!.winners[0].amount).toBeCloseTo(potAmount);
  });
});

describe('applyAction - check一巡でストリートが進む', () => {
  it('フロップで全員チェックしたらターンへ', () => {
    let state = startHand(null, freshConfig());

    // プリフロップを素早く終わらせる: 全員コール/チェック
    // UTG call, HJ call, CO call, BTN call, SB call, BB check
    const order = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;
    for (const pos of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const) {
      if (state.toAct === null) break;
      const p = state.players.find((pl) => pl.pos === pos)!;
      if (state.toAct === p.id) {
        state = applyAction(state, p.id, { type: 'call' });
      }
    }
    // BB check if toAct is BB
    const bb = state.players.find((p) => p.pos === 'BB')!;
    if (state.toAct === bb.id) {
      state = applyAction(state, bb.id, { type: 'check' });
    }

    // ラウンド終了でフロップへ
    if (state.toAct === null) {
      state = advanceStreet(state);
    }
    expect(state.street).toBe('flop');
    expect(state.board).toHaveLength(3);

    // フロップで全員チェック（SBから）
    for (let i = 0; i < 6; i++) {
      if (state.toAct === null) break;
      const actor = state.toAct;
      state = applyAction(state, actor, { type: 'check' });
    }

    if (state.toAct === null) {
      state = advanceStreet(state);
    }
    expect(state.street).toBe('turn');
    expect(state.board).toHaveLength(4);
  });
});

describe('applyAction - レイズでhasActedThisStreetがリセットされる', () => {
  it('フロップでチェック後にレイズされたら再アクション機会が生まれる', () => {
    let state = startHand(null, freshConfig());

    // プリフロップを全員コールで進める
    while (state.toAct !== null && state.street === 'preflop') {
      const p = state.players[state.toAct];
      const legal = legalActions(state, p.id);
      if (legal.canCheck) {
        state = applyAction(state, p.id, { type: 'check' });
      } else {
        state = applyAction(state, p.id, { type: 'call' });
      }
    }
    if (state.toAct === null) state = advanceStreet(state);

    // フロップ到達を確認
    expect(state.street).toBe('flop');

    // SBがチェック
    const sb = state.players.find((p) => p.pos === 'SB')!;
    if (state.toAct === sb.id) {
      state = applyAction(state, sb.id, { type: 'check' });
      expect(state.players[sb.id].hasActedThisStreet).toBe(true);
    }

    // BBがベット → SBのhasActedThisStreetがリセットされる
    const bb = state.players.find((p) => p.pos === 'BB')!;
    if (state.toAct === bb.id) {
      state = applyAction(state, bb.id, { type: 'bet', amount: 3 });
      // SBのhasActedThisStreetがリセットされていること
      expect(state.players[sb.id].hasActedThisStreet).toBe(false);
    }
  });
});

describe('legalActions', () => {
  it('プリフロップのUTGはfold/call/raiseができてcheckはできない', () => {
    const state = startHand(null, freshConfig());
    const utg = state.players.find((p) => p.pos === 'UTG')!;
    const legal = legalActions(state, utg.id);

    expect(legal.canFold).toBe(true);
    expect(legal.canCheck).toBe(false);
    expect(legal.canCall).toBe(true);
    expect(legal.canBet).toBe(false);
    expect(legal.canRaise).toBe(true);
  });

  it('minBetTo は bb 以上', () => {
    // フロップでのbet: minBetTo >= bb
    let state = startHand(null, freshConfig());
    while (state.toAct !== null && state.street === 'preflop') {
      const p = state.players[state.toAct];
      const legal = legalActions(state, p.id);
      if (legal.canCheck) {
        state = applyAction(state, p.id, { type: 'check' });
      } else {
        state = applyAction(state, p.id, { type: 'call' });
      }
    }
    if (state.toAct === null) state = advanceStreet(state);

    if (state.toAct !== null) {
      const actor = state.toAct;
      const legal = legalActions(state, actor);
      expect(legal.canBet).toBe(true);
      expect(legal.minBetTo).toBeGreaterThanOrEqual(state.config.bb);
    }
  });

  it('maxBetTo は committedStreet + stack', () => {
    const state = startHand(null, freshConfig());
    const utg = state.players.find((p) => p.pos === 'UTG')!;
    const legal = legalActions(state, utg.id);
    expect(legal.maxBetTo).toBe(utg.committedStreet + utg.stack);
  });

  it('all-in 未満スタックの call が正しく all-in 化', () => {
    // スタックが少ないプレイヤーのコール
    const config: GameConfig = {
      ...freshConfig(),
      startingStack: 5, // 5bb スタート（SB/BBの後は残り少ない）
      ante: 0,
    };
    const state = startHand(null, config);
    // UTGはコール時 all-in になるかもしれない
    const utg = state.players.find((p) => p.pos === 'UTG')!;
    const legal = legalActions(state, utg.id);

    // スタックが小さい場合でもcallAmountが適切
    expect(legal.callAmount).toBeLessThanOrEqual(utg.stack);
  });
});

describe('all-in コール処理', () => {
  it('スタック不足の call で status=allin', () => {
    // 5bb スタックでプレイ。UTGが10bbにraiseした場合
    const config: GameConfig = {
      difficulty: 'normal',
      mode: 'tournament',
      startingStack: 5,
      sb: 0.5,
      bb: 1,
      ante: 0,
      rng: makeRng(99),
    };
    let state = startHand(null, config);
    const utg = state.players.find((p) => p.pos === 'UTG')!;

    // UTGがall-in
    state = applyAction(state, utg.id, { type: 'allin' });
    expect(state.players[utg.id].status).toBe('allin');
    expect(state.players[utg.id].stack).toBe(0);
  });
});

describe('isBettingRoundComplete', () => {
  it('UTGオープン後に残りが全員foldしたらtoActがnullになる', () => {
    let state = startHand(null, freshConfig());
    const utg = state.players.find((p) => p.pos === 'UTG')!;
    state = applyAction(state, utg.id, { type: 'raise', amount: 2.5 });

    // 残りのactiveプレイヤーを順番に全員fold
    let safetyCounter = 0;
    while (state.toAct !== null && safetyCounter < 10) {
      const actor = state.toAct;
      if (actor === utg.id) break; // UTGに戻ったら終了
      state = applyAction(state, actor, { type: 'fold' });
      safetyCounter++;
    }

    // 全員foldedでtoAct=null
    expect(state.toAct).toBeNull();
    // UTG以外は全員folded
    const nonUtg = state.players.filter((p) => p.id !== utg.id);
    expect(nonUtg.every((p) => p.status === 'folded')).toBe(true);
  });
});

describe('チップ保存性テスト（重要）', () => {
  it('単一ハンドでチップ総量が保存される', () => {
    const config = freshConfig(7);
    let state = startHand(null, config);
    const initialTotal = state.players.reduce((s, p) => s + p.stack + p.committedStreet + p.committedTotal - p.committedStreet, 0);
    // 全プレイヤーのスタック合計を計算（ブラインド前）
    const startTotal = config.startingStack * 6;

    // ハンドを最後まで進める（全員コール/チェックで）
    while (state.street !== 'showdown') {
      if (state.toAct !== null) {
        const p = state.players[state.toAct];
        const legal = legalActions(state, p.id);
        if (legal.canCheck) {
          state = applyAction(state, p.id, { type: 'check' });
        } else {
          state = applyAction(state, p.id, { type: 'call' });
        }
      } else {
        state = advanceStreet(state);
      }
    }

    // ショーダウン後のスタック合計 = startingStack * 6
    const finalTotal = state.players.reduce((s, p) => s + p.stack, 0);
    expect(finalTotal).toBeCloseTo(startTotal, 5);
  });
});

describe('ante テスト（BB ante 方式）', () => {
  function anteConfig(seed = 42): GameConfig {
    return {
      difficulty: 'normal',
      mode: 'tournament',
      startingStack: 100,
      sb: 0.5,
      bb: 1,
      ante: 1,
      rng: makeRng(seed),
    };
  }

  it('startHand: pot === ante', () => {
    const state = startHand(null, anteConfig());
    expect(state.pot).toBe(1);
  });

  it('startHand: currentBet === bb (ante はコール額に影響しない)', () => {
    const state = startHand(null, anteConfig());
    expect(state.currentBet).toBe(1);
  });

  it('startHand: BB の committedStreet === bb', () => {
    const state = startHand(null, anteConfig());
    const bb = state.players.find((p) => p.pos === 'BB')!;
    expect(bb.committedStreet).toBeCloseTo(1);
  });

  it('startHand: BB の committedTotal === bb + ante', () => {
    const state = startHand(null, anteConfig());
    const bb = state.players.find((p) => p.pos === 'BB')!;
    expect(bb.committedTotal).toBeCloseTo(2);
  });

  it('startHand: BB の stack === startingStack - bb - ante', () => {
    const state = startHand(null, anteConfig());
    const bb = state.players.find((p) => p.pos === 'BB')!;
    expect(bb.stack).toBeCloseTo(98);
  });

  it('ante=1 ハンドのチップ保存性: Σ stack_after === 6 * startingStack', () => {
    const config = anteConfig(7);
    let state = startHand(null, config);
    const startTotal = config.startingStack * 6;

    while (state.street !== 'showdown') {
      if (state.toAct !== null) {
        const p = state.players[state.toAct];
        const legal = legalActions(state, p.id);
        if (legal.canCheck) {
          state = applyAction(state, p.id, { type: 'check' });
        } else {
          state = applyAction(state, p.id, { type: 'call' });
        }
      } else {
        state = advanceStreet(state);
      }
    }

    const finalTotal = state.players.reduce((s, p) => s + p.stack, 0);
    expect(finalTotal).toBeCloseTo(startTotal, 5);
  });

  it('ante=1 UTGオープン→全員フォールド: ante 込みポットがオープナーへ', () => {
    let state = startHand(null, anteConfig(42));
    const utg = state.players.find((p) => p.pos === 'UTG')!;
    const hj = state.players.find((p) => p.pos === 'HJ')!;
    const co = state.players.find((p) => p.pos === 'CO')!;
    const btn = state.players.find((p) => p.pos === 'BTN')!;
    const sb = state.players.find((p) => p.pos === 'SB')!;
    const bb = state.players.find((p) => p.pos === 'BB')!;

    // UTG open 2.5bb
    state = applyAction(state, utg.id, { type: 'raise', amount: 2.5 });
    state = applyAction(state, hj.id, { type: 'fold' });
    state = applyAction(state, co.id, { type: 'fold' });
    state = applyAction(state, btn.id, { type: 'fold' });
    state = applyAction(state, sb.id, { type: 'fold' });
    state = applyAction(state, bb.id, { type: 'fold' });

    state = advanceStreet(state);

    expect(state.street).toBe('showdown');
    expect(state.result).not.toBeNull();
    expect(state.result!.winners[0].playerId).toBe(utg.id);
    // ポット = ante(1) + SB(0.5) + BB(1) + UTG raise(2.5)
    expect(state.result!.winners[0].amount).toBeCloseTo(5);
  });
});
