import { describe, it, expect } from 'vitest';
import { startHand, legalActions, applyAction } from './core/game/engine.ts';
import type { GameConfig } from './core/game/types.ts';
import { isValidBetAmount, forceFoldOutOfTurn, resolveLeaveDuringHand } from './roomsLogic.ts';

/** 決定論的な RNG: シードから lcg 生成(src/core/game/engine.test.ts と同じ手法)。 */
function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

function freshConfig(seed = 42): GameConfig {
  return {
    difficulty: 'normal',
    mode: 'tournament',
    startingStack: 100,
    sb: 0.5,
    bb: 1,
    ante: 0,
    rng: makeRng(seed),
  };
}

// ─── isValidBetAmount (ON-1) ────────────────────────────────────────────────

describe('isValidBetAmount', () => {
  const hand = startHand(null, freshConfig());
  const toActSeat = hand.toAct!;
  const legal = legalActions(hand, toActSeat);

  it('call/check/fold/allin は amount を見ず常に true', () => {
    expect(isValidBetAmount({ type: 'fold' }, legal)).toBe(true);
    expect(isValidBetAmount({ type: 'check' }, legal)).toBe(true);
    expect(isValidBetAmount({ type: 'call' }, legal)).toBe(true);
    expect(isValidBetAmount({ type: 'allin' }, legal)).toBe(true);
  });

  it('bet: legal.minBetTo〜maxBetTo の範囲内なら true', () => {
    expect(isValidBetAmount({ type: 'bet', amount: legal.minBetTo }, legal)).toBe(true);
    expect(isValidBetAmount({ type: 'bet', amount: legal.maxBetTo }, legal)).toBe(true);
  });

  it('bet: 範囲外(下回る/上回る)は false', () => {
    expect(isValidBetAmount({ type: 'bet', amount: legal.minBetTo - 0.5 }, legal)).toBe(false);
    expect(isValidBetAmount({ type: 'bet', amount: legal.maxBetTo + 1 }, legal)).toBe(false);
  });

  it('bet: NaN/Infinity/負数/amount未指定は false', () => {
    expect(isValidBetAmount({ type: 'bet', amount: NaN }, legal)).toBe(false);
    expect(isValidBetAmount({ type: 'bet', amount: Infinity }, legal)).toBe(false);
    expect(isValidBetAmount({ type: 'bet', amount: -5 }, legal)).toBe(false);
    expect(isValidBetAmount({ type: 'bet' }, legal)).toBe(false);
  });
});

// ─── forceFoldOutOfTurn (ON-2) ──────────────────────────────────────────────

describe('forceFoldOutOfTurn', () => {
  it('active なプレイヤーを folded にし、hasActedThisStreet=true にする', () => {
    const hand = startHand(null, freshConfig());
    const toActSeat = hand.toAct!;
    // toActSeat 以外の active な席を対象にする(手番外のケースを再現)。
    const otherActive = hand.players.find((p) => p.status === 'active' && p.id !== toActSeat)!;

    const next = forceFoldOutOfTurn(hand, otherActive.id);
    expect(next.players[otherActive.id].status).toBe('folded');
    expect(next.players[otherActive.id].hasActedThisStreet).toBe(true);
    // 手番はまだ他プレイヤーにあるので変わらない
    expect(next.toAct).toBe(hand.toAct);
    expect(next.log.at(-1)).toMatchObject({ playerId: otherActive.id, action: 'fold' });
  });

  it('active が1人以下になったら toAct=null にする', () => {
    let hand = startHand(null, freshConfig());
    // 手番以外の active な全員を1人ずつ fold させ、最後の1人だけ残す
    let toActSeat = hand.toAct!;
    let remainingActive = hand.players.filter((p) => p.status === 'active' && p.id !== toActSeat);
    for (const p of remainingActive) {
      hand = forceFoldOutOfTurn(hand, p.id);
    }
    expect(hand.players.filter((p) => p.status === 'active')).toHaveLength(1);
    expect(hand.toAct).toBeNull();
    void toActSeat;
  });

  it('allin/folded なプレイヤーには何もしない(参照を変えない)', () => {
    const hand = startHand(null, freshConfig());
    const toActSeat = hand.toAct!;
    const folded = applyAction(hand, toActSeat, { type: 'fold' });
    const target = folded.players.find((p) => p.status === 'folded')!;
    const next = forceFoldOutOfTurn(folded, target.id);
    expect(next).toBe(folded);
  });
});

// ─── resolveLeaveDuringHand (ON-2) ──────────────────────────────────────────

describe('resolveLeaveDuringHand', () => {
  it('hand が null なら何もしない', () => {
    const result = resolveLeaveDuringHand(null, ['a', 'b'], 'a');
    expect(result).toEqual({ hand: null, pendingLeave: false });
  });

  it('uid が現ハンドの座席にいない(途中参加待ち)なら hand をそのまま返す', () => {
    const hand = startHand(null, freshConfig());
    const seatUids = hand.players.map((_, i) => `p${i}`);
    const result = resolveLeaveDuringHand(hand, seatUids, 'not-seated');
    expect(result.hand).toBe(hand);
    expect(result.pendingLeave).toBe(false);
  });

  it('手番の active プレイヤーは(checkできれば)check、できなければfoldされる', () => {
    const hand = startHand(null, freshConfig());
    const seatUids = hand.players.map((_, i) => `p${i}`);
    const toActSeat = hand.toAct!;
    const uid = seatUids[toActSeat];

    const result = resolveLeaveDuringHand(hand, seatUids, uid);
    expect(result.pendingLeave).toBe(false);
    // preflopの最初のtoActはcheckできない(コールかフォールドが必要)ため folded になるはず
    const legal = legalActions(hand, toActSeat);
    if (legal.canCheck) {
      expect(result.hand!.players[toActSeat].status).toBe('active');
    } else {
      expect(result.hand!.players[toActSeat].status).toBe('folded');
    }
  });

  it('手番でない active プレイヤーも強制foldされる(ON-2 の主眼)', () => {
    const hand = startHand(null, freshConfig());
    const seatUids = hand.players.map((_, i) => `p${i}`);
    const toActSeat = hand.toAct!;
    const otherActive = hand.players.find((p) => p.status === 'active' && p.id !== toActSeat)!;
    const uid = seatUids[otherActive.id];

    const result = resolveLeaveDuringHand(hand, seatUids, uid);
    expect(result.pendingLeave).toBe(false);
    expect(result.hand!.players[otherActive.id].status).toBe('folded');
    // 手番自体は変わらない(他のプレイヤーの手番はそのまま)
    expect(result.hand!.toAct).toBe(toActSeat);
  });

  it('allin 中のプレイヤーは hand を変更せず pendingLeave=true を返す', () => {
    const hand = startHand(null, freshConfig());
    const seatUids = hand.players.map((_, i) => `p${i}`);
    const toActSeat = hand.toAct!;
    // engine.ts の 'allin' アクションは常に status='allin' を確定させる(スタック残量に関わらず)。
    const allinHand = applyAction(hand, toActSeat, { type: 'allin' });
    expect(allinHand.players[toActSeat].status).toBe('allin');

    const uid = seatUids[toActSeat];
    const result = resolveLeaveDuringHand(allinHand, seatUids, uid);
    expect(result.pendingLeave).toBe(true);
    expect(result.hand).toBe(allinHand);
  });

  it('既に folded なプレイヤーは hand をそのまま返す', () => {
    const hand = startHand(null, freshConfig());
    const seatUids = hand.players.map((_, i) => `p${i}`);
    const toActSeat = hand.toAct!;
    const foldedHand = applyAction(hand, toActSeat, { type: 'fold' });
    const uid = seatUids[toActSeat];

    const result = resolveLeaveDuringHand(foldedHand, seatUids, uid);
    expect(result.pendingLeave).toBe(false);
    expect(result.hand).toBe(foldedHand);
  });
});
