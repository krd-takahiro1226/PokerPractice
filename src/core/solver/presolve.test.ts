import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card } from '../cards';
import type { HandLogEntry } from '../game/types';
import type { Position } from '../ranges/types';
import type { SavedHand } from '../../store/history';
import { buildSnapshots, type DecisionSnapshot } from '../review/snapshot';
import { analyzeSnapshot } from './index';
import {
  _resetPresolveForTest,
  lookupPresolve,
  preloadPresolve,
  setPresolveFetcher,
  type PresolveFetcher,
} from './presolve';
import type { AnalyzeContext } from './types';
import {
  parseFinalExploitability,
  parseFlopTree,
  type SolverNode,
} from '../../../scripts/presolve/parse';
import { rangeToSolverString } from '../../../scripts/presolve/solverIO';

// ── 実データ（public/presolve/srp-btn-bb/）を使う lookup テスト ─────────────
// スターターDB生成後にのみ意味を持つため、生成物が無い環境では skip する。

const DATA_DIR = join(process.cwd(), 'public/presolve');
const STARTER_FLOP = 'AcKd7h'; // scripts/presolve/flops.ts の STARTER_FLOPS[0]（canonical）
const hasData = existsSync(join(DATA_DIR, 'srp-btn-bb', `${STARTER_FLOP}.json`));

const fsFetcher: PresolveFetcher = async (path) => {
  const p = join(DATA_DIR, path);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
};

/** BTN(hero, playerId 0) open 2.5bb → BB call の SRP flop ハンドを組み立てる。
 *  flop で BB check → hero が betBB を bet（line 'x' の判断）。 */
function btnHeroHand(opts: { betBB: number; stack?: number; v3?: boolean; hole?: [Card, Card] }): SavedHand {
  const stack = opts.stack ?? 100;
  const v3 = opts.v3 ?? true;
  // buttonSeat=0: 0=BTN 1=SB 2=BB 3=UTG 4=HJ 5=CO
  const pos = (id: number): Position => (['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'] as Position[])[id];
  const entry = (
    street: HandLogEntry['street'],
    playerId: number,
    action: HandLogEntry['action'],
    potAfter: number,
    amount?: number,
  ): HandLogEntry => ({ street, playerId, pos: pos(playerId), action, amount, potAfter });

  const betAmount = opts.betBB;
  const log: HandLogEntry[] = [
    entry('preflop', 3, 'fold', 1.5),
    entry('preflop', 4, 'fold', 1.5),
    entry('preflop', 5, 'fold', 1.5),
    entry('preflop', 0, 'raise', 4.0, 2.5),
    entry('preflop', 1, 'fold', 4.0),
    entry('preflop', 2, 'call', 5.5, 2.5),
    entry('flop', 2, 'check', 5.5),
    entry('flop', 0, 'bet', 5.5 + betAmount, betAmount),
    entry('flop', 2, 'fold', 5.5 + betAmount),
  ];
  return {
    id: 'test-btn',
    ts: 0,
    mode: 'cash-noante',
    difficulty: 'normal',
    heroPos: 'BTN',
    heroHole: opts.hole ?? ['Ah', 'Th'],
    board: ['Ac', 'Kd', '7h'],
    log,
    result: { winners: [{ playerId: 0, amount: 5.5 + betAmount }], shown: [], board: ['Ac', 'Kd', '7h'], endedAtStreet: 'flop' },
    heroNet: 3.0,
    ...(v3
      ? {
          version: 3,
          stacks: [stack, stack, stack, stack, stack, stack],
          blinds: { sb: 0.5, bb: 1, ante: 0 },
          buttonSeat: 0,
          playerCount: 6,
        }
      : {}),
  };
}

/** BB(hero, playerId 0) が BTN open にコールした SRP flop ハンド。
 *  flop で hero check（line ''）→ BTN bet betBB → hero call（line 'x-b<pct>'）。
 *  betBB 既定 1.8 = 33% pot（line 'x-b33'）。 */
function bbHeroHand(betBB = 1.8): SavedHand {
  // buttonSeat=4: 0=BB 1=UTG 2=HJ 3=CO 4=BTN 5=SB
  const posMap: Position[] = ['BB', 'UTG', 'HJ', 'CO', 'BTN', 'SB'];
  const entry = (
    street: HandLogEntry['street'],
    playerId: number,
    action: HandLogEntry['action'],
    potAfter: number,
    amount?: number,
  ): HandLogEntry => ({ street, playerId, pos: posMap[playerId], action, amount, potAfter });

  const log: HandLogEntry[] = [
    entry('preflop', 1, 'fold', 1.5),
    entry('preflop', 2, 'fold', 1.5),
    entry('preflop', 3, 'fold', 1.5),
    entry('preflop', 4, 'raise', 4.0, 2.5),
    entry('preflop', 5, 'fold', 4.0),
    entry('preflop', 0, 'call', 5.5, 2.5),
    entry('flop', 0, 'check', 5.5),
    entry('flop', 4, 'bet', 5.5 + betBB, betBB),
    entry('flop', 0, 'call', 5.5 + 2 * betBB, betBB),
  ];
  return {
    id: 'test-bb',
    ts: 0,
    mode: 'cash-noante',
    difficulty: 'normal',
    heroPos: 'BB',
    heroHole: ['9h', '8h'],
    board: ['Ac', 'Kd', '7h'],
    log,
    result: {
      winners: [{ playerId: 0, amount: 5.5 + 2 * betBB }],
      shown: [],
      board: ['Ac', 'Kd', '7h'],
      endedAtStreet: 'flop',
    },
    heroNet: -4.3,
    version: 3,
    stacks: [100, 100, 100, 100, 100, 100],
    blinds: { sb: 0.5, bb: 1, ante: 0 },
    buttonSeat: 4,
    playerCount: 6,
  };
}

function flopSnapshots(hand: SavedHand): DecisionSnapshot[] {
  return buildSnapshots(hand).filter((s) => s.street === 'flop');
}

function ctxOf(hand: SavedHand): AnalyzeContext {
  return { heroHole: hand.heroHole, mode: hand.mode };
}

describe.skipIf(!hasData)('lookupPresolve（実データ）', () => {
  beforeEach(() => {
    _resetPresolveForTest();
    setPresolveFetcher(fsFetcher);
  });

  it('構成マッチ + line 完全一致（BTN cbet 33%）→ high / source=presolve', async () => {
    const hand = btnHeroHand({ betBB: 1.8 }); // 1.8/5.5 = 32.7% → b33
    const snapshot = flopSnapshots(hand)[0];
    await preloadPresolve([snapshot]);
    const advice = lookupPresolve(snapshot, ctxOf(hand));
    expect(advice).not.toBeNull();
    expect(advice!.source).toBe('presolve');
    expect(advice!.confidence).toBe('high');
    expect(advice!.spot.line).toBe('x');
    expect(advice!.spot.flopIso).toBe(STARTER_FLOP);
    // 頻度は降順・合計 ~1
    const freqs = advice!.candidates.map((c) => c.frequency);
    expect([...freqs].sort((a, b) => b - a)).toEqual(freqs);
    expect(freqs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
    // taken (bet 33%) がマッチし evBB は未設定（§12.3 MVP）
    expect(advice!.takenCandidate?.action).toBe('bet');
    expect(advice!.takenCandidate?.evBB).toBeUndefined();
    expect(advice!.candidates.every((c) => c.explanationKeys.includes('presolve-strategy'))).toBe(true);
  });

  it('OOP root（line=\'\'）と facing cbet（line \'x-b33\'）も解決できる', async () => {
    const hand = bbHeroHand();
    const snapshots = flopSnapshots(hand);
    expect(snapshots).toHaveLength(2);
    await preloadPresolve(snapshots);

    const rootAdvice = lookupPresolve(snapshots[0], ctxOf(hand));
    expect(rootAdvice).not.toBeNull();
    expect(rootAdvice!.spot.line).toBe('');
    expect(rootAdvice!.spot.ip).toBe(false);
    expect(rootAdvice!.takenCandidate?.action).toBe('check');

    const facingAdvice = lookupPresolve(snapshots[1], ctxOf(hand));
    expect(facingAdvice).not.toBeNull();
    expect(facingAdvice!.spot.line).toBe('x-b33');
    expect(facingAdvice!.takenCandidate?.action).toBe('call');
  });

  it('サイズ近傍マッチ（line 中の b40 → b33 ノード）→ medium + presolve-size-approx', async () => {
    // line は「判断より前の履歴」なので、非標準サイズは相手（BTN）の bet で作る。
    // hero(BB) が 40% pot cbet に直面 → line 'x-b40' → DB の 'x-b33' へ近傍マッチ。
    const hand = bbHeroHand(2.2); // 2.2/5.5 = 40%
    const snapshots = flopSnapshots(hand);
    const facing = snapshots[1];
    expect(facing.street).toBe('flop');
    await preloadPresolve([facing]);
    const advice = lookupPresolve(facing, ctxOf(hand));
    expect(advice).not.toBeNull();
    expect(advice!.spot.line).toBe('x-b40');
    expect(advice!.confidence).toBe('medium');
    expect(advice!.candidates[0].explanationKeys).toContain('presolve-size-approx');
  });

  it('トークン解決不能（line 中の bet 200% pot・相対誤差 40% 超）→ null', async () => {
    const hand = bbHeroHand(11); // 11/5.5 = 200% pot → line 'x-b200'
    const facing = flopSnapshots(hand)[1];
    await preloadPresolve([facing]);
    expect(lookupPresolve(facing, ctxOf(hand))).toBeNull();
  });

  it('sprBucket 不一致（20bb スタック）→ null', async () => {
    const hand = btnHeroHand({ betBB: 1.8, stack: 20 });
    const snapshot = flopSnapshots(hand)[0];
    expect(snapshot.spr).not.toBeNull();
    expect(snapshot.spr!).toBeLessThan(6);
    await preloadPresolve([snapshot]);
    expect(lookupPresolve(snapshot, ctxOf(hand))).toBeNull();
  });

  it('reliability=approx（v2 旧データ）は一段階降格 → medium', async () => {
    const hand = btnHeroHand({ betBB: 1.8, v3: false });
    const snapshot = flopSnapshots(hand)[0];
    expect(snapshot.reliability).toBe('approx');
    await preloadPresolve([snapshot]);
    const advice = lookupPresolve(snapshot, ctxOf(hand));
    expect(advice).not.toBeNull();
    expect(advice!.confidence).toBe('medium');
  });

  it('fetch 失敗（throw / null）→ null（解析は落ちない）', async () => {
    const hand = btnHeroHand({ betBB: 1.8 });
    const snapshot = flopSnapshots(hand)[0];

    setPresolveFetcher(async () => {
      throw new Error('network');
    });
    await preloadPresolve([snapshot]);
    expect(lookupPresolve(snapshot, ctxOf(hand))).toBeNull();

    _resetPresolveForTest();
    setPresolveFetcher(async () => null);
    await preloadPresolve([snapshot]);
    expect(lookupPresolve(snapshot, ctxOf(hand))).toBeNull();
  });

  it('preload 前は null（同期 lookup はキャッシュのみ参照）', () => {
    const hand = btnHeroHand({ betBB: 1.8 });
    const snapshot = flopSnapshots(hand)[0];
    expect(lookupPresolve(snapshot, ctxOf(hand))).toBeNull();
  });

  it('analyzeSnapshot が HU flop で presolve を返す（振り分け接続）', async () => {
    const hand = btnHeroHand({ betBB: 1.8 });
    const snapshot = flopSnapshots(hand)[0];
    await preloadPresolve([snapshot]);
    const advice = analyzeSnapshot(snapshot, ctxOf(hand));
    expect(advice.source).toBe('presolve');
  });
});

// ── パーサ（scripts/presolve/parse.ts）ユニットテスト ────────────────────────
// TexasSolver 実出力（pot=100 fixture）から縮約した合成木で金額規約を凍結する。
// 規約: BET/RAISE ラベルの数値 = そのアクションでの追加投入額（RAISE はコール分込みの合計）。

describe('parseFlopTree（TexasSolver 縮約フィクスチャ）', () => {
  // pot 55（bb×10 スケール）, eff stack 975。
  // b33: round(0.33*55)=18, b75: round(0.75*55)=41。
  // OOP bet 18 後の IP raise 60%: max_commit*2 = (27.5+18)*2 = 91 → 0.6*91=54.6→55, +18 = 73。
  const strat2 = (a: number, b: number) => ({ '9h8h': [a, b], '9d8d': [a, b] });
  const strat3 = (a: number, b: number, c: number) => ({ '9h8h': [a, b, c], '9d8d': [a, b, c] });

  const leaf: SolverNode = { node_type: 'chance_node', deal_number: 0 };
  const fixture: SolverNode = {
    node_type: 'action_node',
    player: 1,
    actions: ['CHECK', 'BET 18.000000', 'BET 975.000000'],
    strategy: { actions: ['CHECK', 'BET 18.000000', 'BET 975.000000'], strategy: strat3(0.5, 0.4, 0.1) },
    childrens: {
      CHECK: {
        node_type: 'action_node',
        player: 0,
        actions: ['CHECK', 'BET 18.000000'],
        strategy: { actions: ['CHECK', 'BET 18.000000'], strategy: strat2(0.7, 0.3) },
        childrens: {
          CHECK: leaf,
          'BET 18.000000': {
            node_type: 'action_node',
            player: 1,
            actions: ['CALL', 'RAISE 73.000000', 'FOLD'],
            strategy: { actions: ['CALL', 'RAISE 73.000000', 'FOLD'], strategy: strat3(0.6, 0.1, 0.3) },
            childrens: {
              CALL: leaf,
              // 深さ4トークン目 → 抽出対象外（格納されないこと）
              'RAISE 73.000000': {
                node_type: 'action_node',
                player: 0,
                actions: ['CALL', 'FOLD'],
                strategy: { actions: ['CALL', 'FOLD'], strategy: strat2(0.5, 0.5) },
                childrens: { CALL: leaf },
              },
            },
          },
        },
      },
      'BET 18.000000': {
        node_type: 'action_node',
        player: 0,
        actions: ['CALL', 'RAISE 73.000000', 'RAISE 975.000000', 'FOLD'],
        strategy: {
          actions: ['CALL', 'RAISE 73.000000', 'RAISE 975.000000', 'FOLD'],
          strategy: { '9h8h': [0.25, 0.25, 0.25, 0.25], '9d8d': [0.15, 0.35, 0.25, 0.25] },
        },
        childrens: { CALL: leaf, 'RAISE 73.000000': leaf, 'RAISE 975.000000': leaf },
      },
      'BET 975.000000': {
        node_type: 'action_node',
        player: 0,
        actions: ['CALL', 'FOLD'],
        strategy: { actions: ['CALL', 'FOLD'], strategy: strat2(0.2, 0.8) },
        childrens: { CALL: leaf },
      },
    },
  };

  const cfg = { potBB: 55, effStackBB: 975 };

  it('金額規約: BET=追加投入額 → pot比トークン、RAISE=コール込み追加額 → 実ポット比', () => {
    const nodes = parseFlopTree(fixture, cfg);
    // root: player 1 = OOP。BET 18/55 = 32.7% → b33、BET 975 = 残スタック全部 → a
    expect(nodes[''].actor).toBe('oop');
    expect(nodes[''].actions).toEqual(['x', 'b33', 'a']);
    // b33 後の IP ノード: RAISE 73 は pot 73（55+18）に対する追加 73 → r100。RAISE 975 → a
    expect(nodes['b33'].actor).toBe('ip');
    expect(nodes['b33'].actions).toEqual(['c', 'r100', 'a', 'f']);
    // x 後の IP bet 18 は pot 55 のまま → b33
    expect(nodes['x'].actions).toEqual(['x', 'b33']);
    expect(nodes['x-b33'].actor).toBe('oop');
    expect(nodes['x-b33'].actions).toEqual(['c', 'r100', 'f']);
  });

  it('combo → handClass 集計（クラス内単純平均・3桁丸め）', () => {
    const nodes = parseFlopTree(fixture, cfg);
    // 'b33' ノード: 9h8h [0.25,...], 9d8d [0.15,0.35,...] → 平均 [0.2, 0.3, 0.25, 0.25]
    expect(nodes['b33'].strat['98s']).toEqual([0.2, 0.3, 0.25, 0.25]);
  });

  it('深さ3トークンまでを格納し、それ以深は含めない', () => {
    const nodes = parseFlopTree(fixture, cfg);
    expect(Object.keys(nodes).sort()).toEqual(['', 'a', 'b33', 'x', 'x-b33', 'x-b33-r100'].sort());
    expect(nodes['x-b33-r100']).toBeDefined(); // 3トークン目は格納される（展開はしない）
  });

  it('strategy.actions と actions の食い違いは throw（データ破損検出）', () => {
    const broken: SolverNode = {
      node_type: 'action_node',
      player: 1,
      actions: ['CHECK', 'BET 18.000000'],
      strategy: { actions: ['BET 18.000000', 'CHECK'], strategy: strat2(0.5, 0.5) },
      childrens: {},
    };
    expect(() => parseFlopTree(broken, cfg)).toThrow();
  });

  it('parseFinalExploitability は最後の値を返す', () => {
    const stdout = [
      'Total exploitability 266.63995 precent',
      'Total exploitability 39.024643 precent',
      'Total exploitability 0.42 precent',
    ].join('\n');
    expect(parseFinalExploitability(stdout)).toBeCloseTo(0.42);
    expect(parseFinalExploitability('no match')).toBeNull();
  });
});

describe('rangeToSolverString', () => {
  it('freq=1 は省略、freq<1 は :freq を付ける', () => {
    expect(rangeToSolverString({ AA: 1, KQs: 0.5, T9s: 0 })).toBe('AA,KQs:0.5');
  });
});
