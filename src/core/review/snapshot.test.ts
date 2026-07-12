import { describe, it, expect } from 'vitest';
import {
  startHand,
  legalActions,
  applyAction,
  advanceStreet,
} from '../game/engine';
import type { GameConfig, GameState, PlayerAction } from '../game/types';
import { savedHandV3Fields, type SavedHand } from '../../store/history';
import { buildSnapshots, type DecisionSnapshot } from './snapshot';

/** 決定論的な RNG（engine.test.ts と同じ LCG） */
function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

function freshConfig(overrides: Partial<GameConfig> = {}, seed = 42): GameConfig {
  return {
    difficulty: 'normal',
    mode: 'tournament',
    startingStack: 100,
    sb: 0.5,
    bb: 1,
    ante: 0,
    rng: makeRng(seed),
    ...overrides,
  };
}

type Scripted = { playerId: number; action: PlayerAction };

/** エンジンをオラクルとして期待値を記録する（§8.1）。
 *  各ヒーロー判断の直前に GameState から期待スナップショットを控える。 */
type ExpectedDecision = {
  logIndex: number;
  street: GameState['street'];
  board: GameState['board'];
  potBefore: number;
  legal: ReturnType<typeof legalActions>;
  players: DecisionSnapshot['players'];
  effectiveStack: number;
};

function expectedFromState(state: GameState): ExpectedDecision {
  const legal = legalActions(state, 0);
  const hero = state.players[0];
  const villains = state.players.filter((p) => p.id !== 0 && p.status !== 'folded');
  const maxVillain = villains.reduce((m, p) => Math.max(m, p.stack), 0);
  return {
    logIndex: state.log.length,
    street: state.street,
    board: [...state.board],
    potBefore: state.pot + state.players.reduce((t, p) => t + p.committedStreet, 0),
    legal,
    players: state.players.map((p) => ({
      playerId: p.id,
      pos: p.pos,
      stack: p.stack,
      committedStreet: p.committedStreet,
      committedTotal: p.committedTotal,
      status: p.status,
    })),
    effectiveStack: Math.min(hero.stack, maxVillain),
  };
}

function runScripted(
  config: GameConfig,
  seatStacks: number[] | undefined,
  script: Scripted[],
): { state: GameState; expected: ExpectedDecision[] } {
  let state = startHand(null, config, seatStacks);
  const expected: ExpectedDecision[] = [];
  let si = 0;
  let guard = 0;
  while (state.result === null) {
    if (++guard > 200) throw new Error('runScripted: no progress');
    if (state.toAct === null) {
      state = advanceStreet(state);
      continue;
    }
    const s = script[si++];
    if (!s) throw new Error(`script exhausted (toAct=${state.toAct}, street=${state.street})`);
    expect(state.toAct).toBe(s.playerId);
    if (s.playerId === 0) expected.push(expectedFromState(state));
    state = applyAction(state, s.playerId, s.action);
  }
  expect(si).toBe(script.length);
  return { state, expected };
}

function toSavedHand(state: GameState): SavedHand {
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

/** スナップショットとオラクル期待値の全フィールド突合。 */
function assertMatches(snapshots: DecisionSnapshot[], expected: ExpectedDecision[]): void {
  expect(snapshots).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const s = snapshots[i];
    const e = expected[i];
    expect(s.logIndex).toBe(e.logIndex);
    expect(s.street).toBe(e.street);
    expect(s.board).toEqual(e.board);
    expect(s.potBefore).toBeCloseTo(e.potBefore, 9);
    expect(s.toCall).toBeCloseTo(Math.max(0, e.legal.callAmount), 9);
    expect(s.legal).toEqual(e.legal);
    expect(s.players).toEqual(e.players);
    expect(s.effectiveStack).toBeCloseTo(e.effectiveStack, 9);
    expect(s.actor.playerId).toBe(0);
    expect(s.actor.isHero).toBe(true);
    expect(s.reliability).toBe('exact');
  }
}

// 6-max・buttonSeat=0 のポジション: 0=BTN, 1=SB, 2=BB, 3=UTG, 4=HJ, 5=CO
// プリフロップ順: 3→4→5→0→1→2 / ポストフロップ順: 1→2→…→0

describe('buildSnapshots: エンジンオラクル突合（v3 データ）', () => {
  it('6-max 標準 SRP（マルチウェイ flop → HU turn/river）', () => {
    const { state, expected } = runScripted(freshConfig(), undefined, [
      { playerId: 3, action: { type: 'fold' } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'raise', amount: 2.5 } },
      { playerId: 0, action: { type: 'call' } },
      { playerId: 1, action: { type: 'fold' } },
      { playerId: 2, action: { type: 'call' } },
      // flop
      { playerId: 2, action: { type: 'check' } },
      { playerId: 5, action: { type: 'bet', amount: 3 } },
      { playerId: 0, action: { type: 'call' } },
      { playerId: 2, action: { type: 'fold' } },
      // turn
      { playerId: 5, action: { type: 'bet', amount: 6 } },
      { playerId: 0, action: { type: 'call' } },
      // river
      { playerId: 5, action: { type: 'check' } },
      { playerId: 0, action: { type: 'bet', amount: 10 } },
      { playerId: 5, action: { type: 'call' } },
    ]);
    const snapshots = buildSnapshots(toSavedHand(state));
    assertMatches(snapshots, expected);

    // context の検証
    const [pre, flop, turn, river] = snapshots;
    expect(pre.context.openerPos).toBe('CO');
    expect(pre.context.isMultiway).toBe(true);
    expect(flop.context.isMultiway).toBe(true); // BB と CO が生存
    expect(flop.context.villainIds).toEqual([2, 5]);
    expect(flop.context.facingBet).toBeDefined();
    expect(flop.context.facingBet!.amount).toBeCloseTo(3, 9);
    expect(flop.context.facingBet!.potRatio).toBeCloseTo(3 / 8, 9);
    expect(flop.context.facingBet!.from).toBe('CO');
    expect(flop.context.heroHasInitiative).toBe(false);
    expect(turn.context.isMultiway).toBe(false);
    expect(turn.context.villainIds).toEqual([5]);
    expect(river.taken.action).toBe('bet');
    expect(river.taken.amountTo).toBeCloseTo(10, 9);
    expect(river.taken.additional).toBeCloseTo(10, 9);
  });

  it('リンプポット（オープナーなし）', () => {
    const { state, expected } = runScripted(freshConfig(), undefined, [
      { playerId: 3, action: { type: 'fold' } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'call' } },
      { playerId: 0, action: { type: 'call' } },
      { playerId: 1, action: { type: 'call' } },
      { playerId: 2, action: { type: 'check' } },
      // flop: 全員チェック
      { playerId: 1, action: { type: 'check' } },
      { playerId: 2, action: { type: 'check' } },
      { playerId: 5, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
      // turn
      { playerId: 1, action: { type: 'check' } },
      { playerId: 2, action: { type: 'check' } },
      { playerId: 5, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
      // river
      { playerId: 1, action: { type: 'check' } },
      { playerId: 2, action: { type: 'check' } },
      { playerId: 5, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
    ]);
    const snapshots = buildSnapshots(toSavedHand(state));
    assertMatches(snapshots, expected);
    expect(snapshots[0].context.openerPos).toBeUndefined();
  });

  it('3bet→4bet→コール', () => {
    const { state, expected } = runScripted(freshConfig(), undefined, [
      { playerId: 3, action: { type: 'raise', amount: 2.5 } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'fold' } },
      { playerId: 0, action: { type: 'raise', amount: 7.5 } },
      { playerId: 1, action: { type: 'fold' } },
      { playerId: 2, action: { type: 'fold' } },
      { playerId: 3, action: { type: 'raise', amount: 18 } },
      { playerId: 0, action: { type: 'call' } },
      // flop
      { playerId: 3, action: { type: 'bet', amount: 20 } },
      { playerId: 0, action: { type: 'call' } },
      // turn
      { playerId: 3, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
      // river
      { playerId: 3, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
    ]);
    const snapshots = buildSnapshots(toSavedHand(state));
    assertMatches(snapshots, expected);
    expect(snapshots[0].context.openerPos).toBe('UTG');
    // 4bet に直面したコール
    expect(snapshots[1].toCall).toBeCloseTo(18 - 7.5, 9);
    expect(snapshots[1].context.heroHasInitiative).toBe(false);
  });

  it('squeeze（オープン + コーラーに対する 3bet）で全員フォールド', () => {
    const { state, expected } = runScripted(freshConfig(), undefined, [
      { playerId: 3, action: { type: 'raise', amount: 2.5 } },
      { playerId: 4, action: { type: 'call' } },
      { playerId: 5, action: { type: 'fold' } },
      { playerId: 0, action: { type: 'raise', amount: 12 } },
      { playerId: 1, action: { type: 'fold' } },
      { playerId: 2, action: { type: 'fold' } },
      { playerId: 3, action: { type: 'fold' } },
      { playerId: 4, action: { type: 'fold' } },
    ]);
    const snapshots = buildSnapshots(toSavedHand(state));
    assertMatches(snapshots, expected);
    // CO(5) はヒーローの判断前にフォールド済み
    expect(snapshots[0].context.villainIds).toEqual([1, 2, 3, 4]);
    expect(snapshots[0].taken.action).toBe('raise');
    expect(snapshots[0].taken.amountTo).toBeCloseTo(12, 9);
  });

  it('最小レイズ未満のショートオールイン: レイズ権の非再オープン（canRaise=false）', () => {
    // BB(seat2) が 4bb: UTG 3bb オープン + hero コールに対し allin 4bb（増分 1 < minRaise 2）。
    // 注: エンジンは active が hero 1人だけになるとオールインへの判断機会なしで runout する
    // ため、UTG を active に残した形でヒーローの「非再オープンのコール」を発生させる。
    const { state, expected } = runScripted(freshConfig(), [100, 100, 4, 100, 100, 100], [
      { playerId: 3, action: { type: 'raise', amount: 3 } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'fold' } },
      { playerId: 0, action: { type: 'call' } },
      { playerId: 1, action: { type: 'fold' } },
      { playerId: 2, action: { type: 'allin' } },
      { playerId: 3, action: { type: 'call' } },
      { playerId: 0, action: { type: 'call' } },
      // flop 以降は UTG とチェックダウン
      { playerId: 3, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
      { playerId: 3, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
      { playerId: 3, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
    ]);
    // オラクル側の前提確認: ヒーローの2回目の判断で canRaise=false（レイズ権なし）
    expect(expected[1].legal.canRaise).toBe(false);
    expect(expected[1].legal.callAmount).toBeCloseTo(1, 9);
    const snapshots = buildSnapshots(toSavedHand(state));
    assertMatches(snapshots, expected);
  });

  it('複数オールイン + サイドポット', () => {
    const { state, expected } = runScripted(freshConfig(), [100, 20, 50, 100, 100, 100], [
      { playerId: 3, action: { type: 'call' } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'fold' } },
      { playerId: 0, action: { type: 'raise', amount: 3 } },
      { playerId: 1, action: { type: 'allin' } },   // SB 20bb（フルレイズ）
      { playerId: 2, action: { type: 'allin' } },   // BB 50bb（フルレイズ）
      { playerId: 3, action: { type: 'call' } },
      { playerId: 0, action: { type: 'call' } },
      // flop 以降は UTG とチェックダウン（SB/BB はオールイン済み）
      { playerId: 3, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
      { playerId: 3, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
      { playerId: 3, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
    ]);
    // 2つのオールインに直面したヒーローのコール額
    expect(expected[1].legal.callAmount).toBeCloseTo(47, 9);
    const snapshots = buildSnapshots(toSavedHand(state));
    assertMatches(snapshots, expected);
  });

  it('HU（n=2）: SB=BTN が先手、ポストフロップは BB が先手', () => {
    const { state, expected } = runScripted(freshConfig(), [100, 100], [
      { playerId: 0, action: { type: 'raise', amount: 2.5 } },
      { playerId: 1, action: { type: 'call' } },
      // flop
      { playerId: 1, action: { type: 'check' } },
      { playerId: 0, action: { type: 'bet', amount: 2.5 } },
      { playerId: 1, action: { type: 'call' } },
      // turn
      { playerId: 1, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
      // river
      { playerId: 1, action: { type: 'bet', amount: 5 } },
      { playerId: 0, action: { type: 'call' } },
    ]);
    const snapshots = buildSnapshots(toSavedHand(state));
    assertMatches(snapshots, expected);
    expect(snapshots[0].actor.pos).toBe('SB');
    // flop cbet 時点でヒーローがイニシアチブ保持
    expect(snapshots[1].context.heroHasInitiative).toBe(true);
    // river はヒーローがベットに直面
    const river = snapshots[snapshots.length - 1];
    expect(river.context.facingBet?.from).toBe('BB');
  });

  it('ante あり（BB ante 1bb が pot 初期値に入る）', () => {
    const { state, expected } = runScripted(freshConfig({ ante: 1 }), undefined, [
      { playerId: 3, action: { type: 'fold' } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'fold' } },
      { playerId: 0, action: { type: 'raise', amount: 2.5 } },
      { playerId: 1, action: { type: 'fold' } },
      { playerId: 2, action: { type: 'call' } },
      // flop
      { playerId: 2, action: { type: 'check' } },
      { playerId: 0, action: { type: 'bet', amount: 2 } },
      { playerId: 2, action: { type: 'fold' } },
    ]);
    // ヒーロー初回判断時: pot = ante 1 + SB 0.5 + BB 1
    expect(expected[0].potBefore).toBeCloseTo(2.5, 9);
    const snapshots = buildSnapshots(toSavedHand(state));
    assertMatches(snapshots, expected);
  });

  it.each([[3], [4], [5]])('n=%i テーブルのポジション割当がエンジンと一致する', (n) => {
    // 全員フォールドアラウンド（ヒーローは即フォールド）
    let state = startHand(null, freshConfig(), Array(n).fill(100));
    const posById = new Map(state.players.map((p) => [p.id, p.pos]));
    const expected: ExpectedDecision[] = [];
    let guard = 0;
    while (state.result === null) {
      if (++guard > 50) throw new Error('no progress');
      if (state.toAct === null) {
        state = advanceStreet(state);
        continue;
      }
      if (state.toAct === 0) expected.push(expectedFromState(state));
      const legal = legalActions(state, state.toAct);
      state = applyAction(state, state.toAct, { type: legal.canCheck ? 'check' : 'fold' });
    }
    const snapshots = buildSnapshots(toSavedHand(state));
    assertMatches(snapshots, expected);
    for (const s of snapshots) {
      for (const p of s.players) {
        expect(p.pos).toBe(posById.get(p.playerId));
      }
    }
  });
});

describe('buildSnapshots: 旧データフォールバック', () => {
  function stripV3(hand: SavedHand): SavedHand {
    const { version, stacks, blinds, buttonSeat, playerCount, ...rest } = hand;
    return rest as SavedHand;
  }

  it('v2 データ: 100bb 仮定で reliability=approx へ降格、会計は一致する', () => {
    const { state, expected } = runScripted(freshConfig(), undefined, [
      { playerId: 3, action: { type: 'fold' } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'raise', amount: 2.5 } },
      { playerId: 0, action: { type: 'call' } },
      { playerId: 1, action: { type: 'fold' } },
      { playerId: 2, action: { type: 'call' } },
      { playerId: 2, action: { type: 'check' } },
      { playerId: 5, action: { type: 'bet', amount: 3 } },
      { playerId: 0, action: { type: 'call' } },
      { playerId: 2, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
      { playerId: 5, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
    ]);
    const snapshots = buildSnapshots(stripV3(toSavedHand(state)));
    expect(snapshots).toHaveLength(expected.length);
    for (let i = 0; i < expected.length; i++) {
      // 実際の開始スタックも 100bb なので、100bb 仮定の会計は厳密一致するはず
      expect(snapshots[i].reliability).toBe('approx');
      expect(snapshots[i].street).toBe(expected[i].street);
      expect(snapshots[i].potBefore).toBeCloseTo(expected[i].potBefore, 9);
      expect(snapshots[i].toCall).toBeCloseTo(Math.max(0, expected[i].legal.callAmount), 9);
      expect(snapshots[i].players).toEqual(expected[i].players);
    }
  });

  it('v2 データ: mode=tournament でも実際に ante なしなら potAfter から ante=0 を逆算する', () => {
    const { state, expected } = runScripted(freshConfig({ mode: 'tournament', ante: 0 }), undefined, [
      { playerId: 3, action: { type: 'fold' } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'fold' } },
      { playerId: 0, action: { type: 'raise', amount: 2.5 } },
      { playerId: 1, action: { type: 'fold' } },
      { playerId: 2, action: { type: 'fold' } },
    ]);
    const snapshots = buildSnapshots(stripV3(toSavedHand(state)));
    expect(snapshots[0].potBefore).toBeCloseTo(expected[0].potBefore, 9);
  });

  it('v2 データ: ante ありハンドの ante を potAfter から復元する', () => {
    const { state, expected } = runScripted(freshConfig({ ante: 1 }), undefined, [
      { playerId: 3, action: { type: 'fold' } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'fold' } },
      { playerId: 0, action: { type: 'raise', amount: 2.5 } },
      { playerId: 1, action: { type: 'fold' } },
      { playerId: 2, action: { type: 'fold' } },
    ]);
    const snapshots = buildSnapshots(stripV3(toSavedHand(state)));
    expect(snapshots[0].potBefore).toBeCloseTo(expected[0].potBefore, 9);
  });

  it('BB がウォークで一度もアクションしないハンドでも復元できる', () => {
    // hero=BTN(0) が fold、SB fold → BB は log に現れない
    const { state } = runScripted(freshConfig(), undefined, [
      { playerId: 3, action: { type: 'fold' } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'fold' } },
      { playerId: 0, action: { type: 'fold' } },
      { playerId: 1, action: { type: 'fold' } },
    ]);
    const snapshots = buildSnapshots(stripV3(toSavedHand(state)));
    expect(snapshots).toHaveLength(1);
    // BB の 1bb がポットに入っている（fold 判断時: SB 0.5 + BB 1）
    expect(snapshots[0].potBefore).toBeCloseTo(1.5, 9);
  });
});

describe('buildSnapshots: 破損データ耐性', () => {
  it('potAfter 不一致の破損データは例外にせず approx へ降格する', () => {
    const { state } = runScripted(freshConfig(), undefined, [
      { playerId: 3, action: { type: 'fold' } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'raise', amount: 2.5 } },
      { playerId: 0, action: { type: 'fold' } },
      { playerId: 1, action: { type: 'fold' } },
      { playerId: 2, action: { type: 'fold' } },
    ]);
    const hand = toSavedHand(state);
    const corrupted: SavedHand = {
      ...hand,
      log: hand.log.map((e, i) => (i === 1 ? { ...e, potAfter: e.potAfter + 5 } : e)),
    };
    const snapshots = buildSnapshots(corrupted);
    expect(snapshots.length).toBeGreaterThan(0);
    for (const s of snapshots) expect(s.reliability).toBe('approx');
  });
});

describe('savedHandV3Fields', () => {
  it('開始スタックを最終 GameState から厳密に導出する（サイドポット・refund 含む）', () => {
    // UTG(3) を active に残さないと、SB/BB オールイン後にヒーローが唯一のチップ保有者となり
    // engine がベッティング完了とみなしてヒーローのコール判断が発生しない（engine.ts:428）。
    const seatStacks = [100, 20, 50, 80, 90, 60];
    const { state } = runScripted(freshConfig(), seatStacks, [
      { playerId: 3, action: { type: 'raise', amount: 3 } },
      { playerId: 4, action: { type: 'fold' } },
      { playerId: 5, action: { type: 'fold' } },
      { playerId: 0, action: { type: 'call' } },
      { playerId: 1, action: { type: 'allin' } },   // SB 20bb
      { playerId: 2, action: { type: 'allin' } },   // BB 50bb
      { playerId: 3, action: { type: 'call' } },
      { playerId: 0, action: { type: 'call' } },
      // flop 以降は hero(0) と UTG(3) でチェックダウン（SB/BB はオールイン済み）
      { playerId: 3, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
      { playerId: 3, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
      { playerId: 3, action: { type: 'check' } },
      { playerId: 0, action: { type: 'check' } },
    ]);
    const fields = savedHandV3Fields(state);
    expect(fields.version).toBe(3);
    expect(fields.stacks.map((s) => Math.round(s * 100) / 100)).toEqual(seatStacks);
    expect(fields.playerCount).toBe(6);
    expect(fields.buttonSeat).toBe(state.buttonSeat);
    expect(fields.blinds).toEqual({ sb: 0.5, bb: 1, ante: 0 });
  });
});
