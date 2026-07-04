import { describe, it, expect } from 'vitest';
import { startHand, legalActions, applyAction, isBettingRoundComplete, advanceStreet, resolveShowdown } from './engine';
import type { GameConfig, GameState, PlayerState } from './types';
import type { Card } from '../cards';

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
    // UTGの2.5オープンはBBの1.0までしかコールされていない（他は0でfold）ので、
    // 差分1.5(=2.5-1.0)は「誰にもコールされなかった」返還としてスタックへ直接戻り、
    // winners.amount には競われた分(=pot-refund=4.0-1.5=2.5)だけが載る（新仕様）。
    expect(state.result!.winners[0].amount).toBeCloseTo(2.5);
    // 最終スタックは常に保存則を満たす: refund+pot の合計はどちらの計算でも同じ
    expect(state.players[utg.id].stack).toBeCloseTo(100 - 2.5 + (0.5 + 1 + 2.5));
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

describe('applyAction - allin (CORE-3): 最小レイズ未満のショートオールインは再オープンしない', () => {
  // 席順(n=6, buttonSeat=0): 0=BTN,1=SB,2=BB,3=UTG,4=HJ,5=CO
  function setupUtgRaiseHjCall(coStack: number) {
    const config = freshConfig();
    const seatStacks = [100, 100, 100, 100, 100, coStack];
    let state = startHand(null, config, seatStacks);
    const utg = state.players.find((p) => p.pos === 'UTG')!;
    const hj = state.players.find((p) => p.pos === 'HJ')!;
    const co = state.players.find((p) => p.pos === 'CO')!;

    // UTG raise to 4 (currentBet 1→4, minRaise = 3)
    state = applyAction(state, utg.id, { type: 'raise', amount: 4 });
    expect(state.minRaise).toBe(3);
    // HJ call to 4
    state = applyAction(state, hj.id, { type: 'call' });
    expect(state.players[hj.id].hasActedThisStreet).toBe(true);

    return { state, utg, hj, co };
  }

  it('増分(2) < minRaise(3) のショートオールインは既アクション済みプレイヤーのhasActedThisStreetをリセットしない', () => {
    const { state: before, utg, hj, co } = setupUtgRaiseHjCall(6); // newCommit=6, increment=2
    const state = applyAction(before, co.id, { type: 'allin' });

    expect(state.currentBet).toBe(6);
    expect(state.minRaise).toBe(3); // ショートレイズはminRaiseを更新しない
    expect(state.players[utg.id].hasActedThisStreet).toBe(true); // リセットされない
    expect(state.players[hj.id].hasActedThisStreet).toBe(true); // リセットされない
  });

  it('増分(16) >= minRaise(3) のフルレイズ相当オールインは従来通り全員リセットする', () => {
    const { state: before, utg, hj, co } = setupUtgRaiseHjCall(20); // newCommit=20, increment=16
    const state = applyAction(before, co.id, { type: 'allin' });

    expect(state.currentBet).toBe(20);
    expect(state.minRaise).toBe(16);
    expect(state.players[utg.id].hasActedThisStreet).toBe(false); // リセットされる
    expect(state.players[hj.id].hasActedThisStreet).toBe(false); // リセットされる
  });
});

describe('applyAction - bet/raise 防御ガード (ON-1 engine側)', () => {
  it('bet の amount が NaN でも additional が負にならず、bbにフォールバックする', () => {
    const state = startHand(null, freshConfig());
    // フロップまで進めてbetの機会を作る
    let s = state;
    while (s.toAct !== null && s.street === 'preflop') {
      const p = s.players[s.toAct];
      const legal = legalActions(s, p.id);
      s = applyAction(s, p.id, legal.canCheck ? { type: 'check' } : { type: 'call' });
    }
    if (s.toAct === null) s = advanceStreet(s);
    expect(s.street).toBe('flop');

    const actor = s.toAct!;
    const before = s.players[actor];
    const next = applyAction(s, actor, { type: 'bet', amount: NaN });
    // NaN は bb にフォールバックされ、additional は非負
    expect(next.currentBet).toBeCloseTo(s.config.bb);
    expect(next.players[actor].stack).toBeGreaterThanOrEqual(0);
    expect(next.players[actor].stack).toBeLessThanOrEqual(before.stack);
  });

  it('raise の amount が負の値でも additional が負にならない(コールと同等以下にクランプ)', () => {
    let state = startHand(null, freshConfig());
    const utg = state.players.find((p) => p.pos === 'UTG')!;
    const beforeStack = state.players[utg.id].stack;
    const next = applyAction(state, utg.id, { type: 'raise', amount: -100 });
    // additional は Math.max(0, ...) でクランプされ、スタックが増えることはない
    expect(next.players[utg.id].stack).toBeLessThanOrEqual(beforeStack);
    expect(next.players[utg.id].stack).toBeGreaterThanOrEqual(0);
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
    // ポット総額 = ante(1) + SB(0.5) + BB(1) + UTG raise(2.5) = 5.0。
    // BBのcommittedTotal(bb+ante=2.0)までしかコールされていないため、UTGの拠出のうち
    // 2.0を超える0.5は誰にもコールされなかった返還としてスタックへ直接戻り、
    // winners.amount には競われた分(=5.0-0.5=4.5)だけが載る（新仕様）。
    expect(state.result!.winners[0].amount).toBeCloseTo(4.5);
    // 最終スタックは常に保存則を満たす: refund+pot の合計は変わらない
    expect(state.players[utg.id].stack).toBeCloseTo(100 - 2.5 + 5);
  });
});

// ─── n=2..5 一般化テスト（ONLINE-VERSUS.md §3.1/3.2/9.5） ─────────────────────

const POS_FROM_BTN_BY_N: Record<number, string[]> = {
  2: ['SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'CO'],
  5: ['BTN', 'SB', 'BB', 'HJ', 'CO'],
};

function startHandN(n: number, buttonSeat = 0, seed = 42): GameState {
  const seatStacks = Array(n).fill(100);
  const config = freshConfig(seed);
  // buttonSeat をずらしたい場合は button=0 の state から回転させて作る
  let state = startHand(null, config, seatStacks);
  for (let i = 0; i < buttonSeat; i++) {
    state = startHand(state, freshConfig(seed + i + 1), seatStacks);
  }
  return state;
}

describe('n人一般化: ポジション割当', () => {
  for (const n of [2, 3, 4, 5]) {
    it(`n=${n}: button=0 のとき posFromBtn テーブル通りに割り当てられる`, () => {
      const state = startHandN(n, 0);
      const expected = POS_FROM_BTN_BY_N[n];
      for (let i = 0; i < n; i++) {
        expect(state.players[i].pos).toBe(expected[i]);
      }
      expect(state.players).toHaveLength(n);
    });
  }

  it('n=6: 既存 posFromBtn と完全一致（回帰）', () => {
    const state = startHandN(6, 0);
    const expected = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
    for (let i = 0; i < 6; i++) {
      expect(state.players[i].pos).toBe(expected[i]);
    }
  });

  for (const n of [2, 3, 4, 5, 6]) {
    it(`n=${n}: 全員にホールカードが重複なく配られる`, () => {
      const state = startHandN(n, 0);
      for (const p of state.players) {
        expect(p.hole).not.toBeNull();
      }
      const allCards = state.players.flatMap((p) => p.hole!);
      expect(new Set(allCards).size).toBe(n * 2);
    });
  }
});

describe('n人一般化: プリフロップ先手', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    it(`n=${n}: プリフロップ先手はBBの次（button+2、n=2ではbuttonのSB自身の次=BB自身が最後）`, () => {
      const state = startHandN(n, 0);
      const bb = state.players.find((p) => p.pos === 'BB')!;
      // BBの次のactiveプレイヤーが最初のtoAct（n=2ではSB=button自身がBBの次）
      const expectedSeat = (bb.id + 1) % n;
      expect(state.toAct).toBe(expectedSeat);
    });
  }
});

describe('n人一般化: ポストフロップ先手（HU修正の回帰確認）', () => {
  it('HU (n=2): ポストフロップ先手はBB（buttonはSBだが後手になる）', () => {
    let state = startHandN(2, 0);
    const sb = state.players.find((p) => p.pos === 'SB')!;
    const bb = state.players.find((p) => p.pos === 'BB')!;
    expect(state.buttonSeat).toBe(sb.id); // HUはbutton=SB

    // プリフロップ: SB(button)がcall、BBがcheckでフロップへ
    state = applyAction(state, state.toAct!, { type: 'call' });
    state = applyAction(state, state.toAct!, { type: 'check' });
    state = advanceStreet(state);

    expect(state.street).toBe('flop');
    expect(state.toAct).toBe(bb.id); // HUポストフロップはBB先手
  });

  for (const n of [3, 4, 5, 6]) {
    it(`n=${n}: ポストフロップ先手はSB（button+1）`, () => {
      let state = startHandN(n, 0);
      const sb = state.players.find((p) => p.pos === 'SB')!;

      // 全員コールしてフロップへ（BBはcheck）
      let guard = 0;
      while (state.street === 'preflop' && guard < n + 2) {
        const acting = state.toAct;
        if (acting === null) break;
        const legal = legalActions(state, acting);
        state = applyAction(state, acting, legal.canCheck ? { type: 'check' } : { type: 'call' });
        guard++;
      }
      if (state.toAct === null) state = advanceStreet(state);

      expect(state.street).toBe('flop');
      expect(state.toAct).toBe(sb.id);
    });
  }
});

describe('n人一般化: チップ保存性（フルハンド playthrough）', () => {
  for (const n of [2, 3, 4, 5, 6]) {
    it(`n=${n}: 全員check/callで完走してもチップ総量が不変`, () => {
      const seatStacks = Array(n).fill(100);
      let state = startHand(null, freshConfig(n * 11), seatStacks);
      const startTotal = state.players.reduce((s, p) => s + p.stack + p.committedStreet, 0);

      let guard = 0;
      while (state.street !== 'showdown' && guard < 200) {
        if (state.toAct !== null) {
          const legal = legalActions(state, state.toAct);
          state = applyAction(state, state.toAct, legal.canCheck ? { type: 'check' } : { type: 'call' });
        } else {
          state = advanceStreet(state);
        }
        guard++;
      }

      expect(state.street).toBe('showdown');
      const finalTotal = state.players.reduce((s, p) => s + p.stack, 0);
      expect(finalTotal).toBeCloseTo(startTotal, 5);
    });
  }
});

// ─── uncalled bet の返還（resolveShowdown） ─────────────────────────────────
// resolveShowdown が直接受け取れる粒度で GameState を組み立て、ボード完成・カード配布に
// deck の RNG を使わせず、勝敗を確定的にする（showdown.test.ts の makePlayer 流儀を踏襲）。

function makeSdPlayer(
  id: number,
  hole: [Card, Card],
  committedTotal: number,
  stack: number,
  status: PlayerState['status'] = 'active',
): PlayerState {
  return {
    id,
    isHero: id === 0,
    pos: 'UTG',
    stack,
    hole,
    committedTotal,
    committedStreet: 0,
    status,
    hasActedThisStreet: false,
  };
}

function makeShowdownState(players: PlayerState[], board: Card[], pot: number): GameState {
  return {
    config: freshConfig(),
    handNumber: 1,
    buttonSeat: 0,
    players,
    board,
    deck: [],
    street: 'river',
    pot,
    currentBet: 0,
    minRaise: 1,
    toAct: null,
    lastAggressor: null,
    log: [],
    result: null,
  };
}

describe('resolveShowdown - uncalled bet の返還', () => {
  it('HU: 短いスタックのコールに対し、超過分は返還され winners に敗者は載らない', () => {
    // A(id0) stack100 all-in、B(id1) stack60 all-in call。Bが勝つボード。
    const board: Card[] = ['2c', '7d', 'Kd', '4s', '9h'];
    const players = [
      makeSdPlayer(0, ['7c', '2h'], 100, 0, 'allin'), // ハイカードのみ（弱い）
      makeSdPlayer(1, ['9c', '9d'], 60, 0, 'allin'), // トリップナイン（強い）
    ];
    const state = makeShowdownState(players, board, 160);
    const result = resolveShowdown(state);

    expect(result.result).not.toBeNull();
    // Bだけがwinnersに載る（Aは敗者であり、返還分はwinnersに含まれない）
    expect(result.result!.winners).toHaveLength(1);
    expect(result.result!.winners[0]).toEqual({ playerId: 1, amount: 120 });

    // Aには40の返還のみ、Bは120を獲得
    expect(result.players[0].stack).toBeCloseTo(40);
    expect(result.players[1].stack).toBeCloseTo(120);

    // チップ保存則: 合計は160のまま
    const total = result.players.reduce((s, p) => s + p.stack, 0);
    expect(total).toBeCloseTo(160);
  });

  it('HU: 一部しかコールされていないベットにフォールドされた場合、winners額に超過分を含めない', () => {
    // A(id0) committedTotal=50, B(id1) committedTotal=20でfold（Aのベットの一部しかコールしていない）
    const board: Card[] = ['2c', '7d', 'Kd', '4s', '9h'];
    const players = [
      makeSdPlayer(0, ['7c', '2h'], 50, 50, 'active'),
      makeSdPlayer(1, ['9c', '9d'], 20, 80, 'folded'),
    ];
    const state = makeShowdownState(players, board, 70);
    const result = resolveShowdown(state);

    expect(result.result).not.toBeNull();
    expect(result.result!.winners).toHaveLength(1);
    // 実際に競われたのはBが拠出した20までの40（20*2）。残り30はAの自己資金の返還であり
    // winnersのamountには含まれない。
    expect(result.result!.winners[0]).toEqual({ playerId: 0, amount: 40 });

    // Aの最終スタック = 50(拠出後) + 30(返還) + 40(pot) = 120
    expect(result.players[0].stack).toBeCloseTo(120);
    // Bは40しか失っていない(80のまま、foldなのでstackは変化しない)
    expect(result.players[1].stack).toBeCloseTo(80);

    const total = result.players.reduce((s, p) => s + p.stack, 0);
    expect(total).toBeCloseTo(200);
  });

  it('3人: 正当なサイドポット（ショートがall-in、残り2人が更にベット）は退行しない', () => {
    // P0(id0): 短いスタックでall-in(50)、最強ハンド(トリップK)→メインポットのみ資格
    // P1(id1): committedTotal=150、2番目の強さ(トリップ9)→サイドポットを獲得
    // P2(id2): committedTotal=150、最弱(ツーペア)
    const board: Card[] = ['2c', '7d', 'Kd', '4s', '9h'];
    const players = [
      makeSdPlayer(0, ['Kc', 'Kh'], 50, 0, 'allin'),
      makeSdPlayer(1, ['9c', '9d'], 150, 0, 'allin'),
      makeSdPlayer(2, ['2h', '7h'], 150, 0, 'active'),
    ];
    const state = makeShowdownState(players, board, 350);
    const result = resolveShowdown(state);

    expect(result.result).not.toBeNull();
    const winners = result.result!.winners;
    expect(winners.find((w) => w.playerId === 0)?.amount).toBeCloseTo(150); // メインポット
    expect(winners.find((w) => w.playerId === 1)?.amount).toBeCloseTo(200); // サイドポット
    expect(winners.find((w) => w.playerId === 2)).toBeUndefined();

    const total = result.players.reduce((s, p) => s + p.stack, 0);
    expect(total).toBeCloseTo(350);
  });

  it('タイ: 同額拠出・同ランクは均等分割のまま（退行しない）', () => {
    const board: Card[] = ['Qh', 'Jh', 'Th', '2d', '3c'];
    const players = [
      makeSdPlayer(0, ['As', 'Kd'], 50, 50, 'active'),
      makeSdPlayer(1, ['Ah', 'Ks'], 50, 50, 'active'),
    ];
    const state = makeShowdownState(players, board, 100);
    const result = resolveShowdown(state);

    expect(result.result!.winners).toHaveLength(2);
    expect(result.result!.winners.find((w) => w.playerId === 0)?.amount).toBeCloseTo(50);
    expect(result.result!.winners.find((w) => w.playerId === 1)?.amount).toBeCloseTo(50);

    // 各プレイヤーの元の持ち込み(stack+committedTotal=100)を保った合計200が保存される
    const total = result.players.reduce((s, p) => s + p.stack, 0);
    expect(total).toBeCloseTo(200);
  });
});
