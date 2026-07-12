import { describe, it, expect } from 'vitest';
import { startHand, applyAction, advanceStreet } from '../game/engine';
import type { GameConfig, GameState, PlayerAction } from '../game/types';
import { savedHandV3Fields, type SavedHand } from '../../store/history';
import { analyzeHand } from './index';

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

function freshConfig(seed = 7): GameConfig {
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

function runScripted(
  config: GameConfig,
  script: { playerId: number; action: PlayerAction }[],
  seatStacks?: number[],
): SavedHand {
  let state: GameState = startHand(null, config, seatStacks);
  let si = 0;
  let guard = 0;
  while (state.result === null) {
    if (++guard > 200) throw new Error('no progress');
    if (state.toAct === null) {
      state = advanceStreet(state);
      continue;
    }
    const s = script[si++];
    if (!s) throw new Error(`script exhausted (toAct=${state.toAct}, street=${state.street})`);
    state = applyAction(state, s.playerId, s.action);
  }
  const hero = state.players[0];
  const heroWin = state.result!.winners
    .filter((w) => w.playerId === 0)
    .reduce((t, w) => t + w.amount, 0);
  return {
    id: 'test',
    ts: 0,
    mode: state.config.mode,
    difficulty: state.config.difficulty,
    heroPos: hero.pos,
    heroHole: hero.hole!,
    board: state.board,
    log: state.log,
    result: state.result!,
    heroNet: heroWin - hero.committedTotal,
    ...savedHandV3Fields(state),
  };
}

describe('analyzeHand: スポット振り分け', () => {
  it('RFI 判断はチャート由来（range-table）で候補頻度が ~1 に合計される', () => {
    // hero=BTN(0) がオープン、その後降りる
    const hand = runScripted(freshConfig(), [
      { playerId: 3, action: { type: 'fold' } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'fold' } },
      { playerId: 0, action: { type: 'raise', amount: 2.5 } },
      { playerId: 1, action: { type: 'fold' } },
      { playerId: 2, action: { type: 'fold' } },
    ]);
    const [rfi] = analyzeHand(hand);
    expect(rfi.snapshot.street).toBe('preflop');
    expect(rfi.advice.source).toBe('range-table');
    expect(rfi.advice.candidates.length).toBeGreaterThan(0);
    const total = rfi.advice.candidates.reduce((s, c) => s + c.frequency, 0);
    expect(total).toBeCloseTo(1, 6);
    // 実アクションは raise。候補に raise があればマッチ、無ければ null（手札依存）
    if (rfi.advice.candidates.some((c) => c.action === 'raise')) {
      expect(rfi.advice.takenCandidate?.action).toBe('raise');
    } else {
      expect(rfi.advice.takenCandidate).toBeNull();
    }
  });

  it('単一オープンに直面したコールは vsOpen チャート（range-table）', () => {
    // CO(5) オープン、hero(0)=BTN が対応
    const hand = runScripted(freshConfig(), [
      { playerId: 3, action: { type: 'fold' } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'raise', amount: 2.5 } },
      { playerId: 0, action: { type: 'call' } },
      { playerId: 1, action: { type: 'fold' } },
      { playerId: 2, action: { type: 'fold' } },
      // flop HU: CO(5) 先手
      { playerId: 5, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
      { playerId: 5, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
      { playerId: 5, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
    ]);
    const results = analyzeHand(hand);
    const preflop = results.find((r) => r.snapshot.street === 'preflop')!;
    expect(preflop.advice.source).toBe('range-table');
    expect(preflop.advice.spot.potType).toBe('srp');
    // flop/turn の判断は legacy（presolve/turn CFR 未実装）、HU river は CFR 厳密解
    const postflop = results.filter((r) => r.snapshot.street !== 'preflop');
    expect(postflop.length).toBeGreaterThan(0);
    for (const r of postflop) {
      expect(r.advice.source).toBe(r.snapshot.street === 'river' ? 'cfr-exact' : 'legacy');
    }
  });

  it('3bet ポット（vs3bet）はデータ未整備のため legacy', () => {
    // UTG(3) open, hero(0) 3bet, UTG 4bet, hero call → hero の2回目判断は 4bet 直面
    const hand = runScripted(freshConfig(), [
      { playerId: 3, action: { type: 'raise', amount: 2.5 } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'fold' } },
      { playerId: 0, action: { type: 'raise', amount: 7.5 } },
      { playerId: 1, action: { type: 'fold' } },
      { playerId: 2, action: { type: 'fold' } },
      { playerId: 3, action: { type: 'raise', amount: 18 } },
      { playerId: 0, action: { type: 'fold' } },
    ]);
    const results = analyzeHand(hand);
    // 1回目: 単一オープンに直面した 3bet → vsOpen（range-table）
    expect(results[0].advice.source).toBe('range-table');
    // 2回目: 4bet 直面（2 raises 前）→ legacy
    expect(results[1].advice.source).toBe('legacy');
    expect(results[1].advice.spot.potType).toBe('4bp');
  });

  it('allin による 3bet もレイズとして数える（potType=3bp・vsOpen チャート適用外）', () => {
    // hero(0)=BTN open 2.5 → SB(1) が 20bb ショートで allin 3bet → hero 判断
    const hand = runScripted(
      freshConfig(),
      [
        { playerId: 3, action: { type: 'fold' } },
        { playerId: 4, action: { type: 'fold' } },
        { playerId: 5, action: { type: 'fold' } },
        { playerId: 0, action: { type: 'raise', amount: 2.5 } },
        { playerId: 1, action: { type: 'allin' } },
        { playerId: 2, action: { type: 'fold' } },
        { playerId: 0, action: { type: 'fold' } },
      ],
      [100, 20, 100, 100, 100, 100],
    );
    const results = analyzeHand(hand);
    // 2回目の hero 判断はショートの allin 3bet 直面 → チャート適用外の legacy、potType は 3bp
    const facing = results[1];
    expect(facing.snapshot.toCall).toBeCloseTo(17.5, 9);
    expect(facing.advice.source).toBe('legacy');
    expect(facing.advice.spot.potType).toBe('3bp');
  });

  it('オープンシュートに直面した判断を RFI と誤分類しない', () => {
    // UTG(3) が 15bb で open shove → hero(0)=BTN の判断は RFI ではない
    const hand = runScripted(
      freshConfig(),
      [
        { playerId: 3, action: { type: 'allin' } },
        { playerId: 4, action: { type: 'fold' } },
        { playerId: 5, action: { type: 'fold' } },
        { playerId: 0, action: { type: 'fold' } },
        { playerId: 1, action: { type: 'fold' } },
        { playerId: 2, action: { type: 'fold' } },
      ],
      [100, 100, 100, 15, 100, 100],
    );
    const [decision] = analyzeHand(hand);
    // allin オープンは通常サイズ前提のチャート適用外 → legacy（RFI 扱いだと誤推奨になる）
    expect(decision.advice.source).toBe('legacy');
    expect(decision.advice.spot.potType).toBe('srp');
  });

  it('HU river の bet 直面判断に CFR 厳密解（cfr-exact）が付く', () => {
    // CO(5) open 2.5 / hero(0)=BTN call / flop・turn は check-check / river: CO 66% pot bet → hero call
    const hand = runScripted(freshConfig(11), [
      { playerId: 3, action: { type: 'fold' } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'raise', amount: 2.5 } },
      { playerId: 0, action: { type: 'call' } },
      { playerId: 1, action: { type: 'fold' } },
      { playerId: 2, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
      { playerId: 5, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
      { playerId: 5, action: { type: 'bet', amount: 4.29 } },
      { playerId: 0, action: { type: 'call' } },
    ]);
    const results = analyzeHand(hand);
    const river = results.find((r) => r.snapshot.street === 'river')!;
    expect(river.advice.source).toBe('cfr-exact');
    const freqTotal = river.advice.candidates.reduce((s, c) => s + c.frequency, 0);
    expect(freqTotal).toBeCloseTo(1, 6);
    // 実アクション call は候補にマッチし、EVロスは非負
    expect(river.advice.takenCandidate?.action).toBe('call');
    expect(river.advice.evLossBB).toBeGreaterThanOrEqual(0);
    // 解の誤差と仮定レンジが開示される
    expect(river.advice.solution).toBeDefined();
    expect(river.advice.solution!.exploitabilityPctPot).toBeLessThanOrEqual(0.25);
    expect(river.advice.solution!.heroRange.label).toContain('BTN');
    expect(river.advice.solution!.villainRange.label).toContain('CO');
    // flop/turn の判断は引き続き legacy
    for (const r of results.filter((x) => x.snapshot.street === 'flop' || x.snapshot.street === 'turn')) {
      expect(r.advice.source).toBe('legacy');
    }
  });

  it('line のベットサイズは「そのアクション時点のポット」比で正規化される', () => {
    // CO(5) open 2.5 / hero(0)=BTN call / flop: CO が pot(6.5bb) の 66% = 4.29bb bet
    const hand = runScripted(freshConfig(), [
      { playerId: 3, action: { type: 'fold' } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'raise', amount: 2.5 } },
      { playerId: 0, action: { type: 'call' } },
      { playerId: 1, action: { type: 'fold' } },
      { playerId: 2, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'bet', amount: 4.29 } },
      { playerId: 0, action: { type: 'fold' } },
    ]);
    const results = analyzeHand(hand);
    const flopDecision = results.find((r) => r.snapshot.street === 'flop')!;
    expect(flopDecision.advice.spot.line).toBe('b66');
  });
});
