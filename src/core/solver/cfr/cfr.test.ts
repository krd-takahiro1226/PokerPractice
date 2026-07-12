import { describe, it, expect } from 'vitest';
import type { Card } from '../../cards';
import { handClassToCombos } from '../../handNotation';
import { buildComboSet, cardId, compatibleMass, showdownValues, type ComboSet, type WeightedCombo } from './terminal';
import { buildRiverTree, type RootState, type TreeConfig } from './tree';
import { solveCfr, type CfrInput } from './cfr';
import { bestResponseTotals, rootEdgeValues } from './exploit';

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

function classIndex(set: ComboSet, handClass: string): number {
  const idx = set.classKey.indexOf(handClass);
  expect(idx).toBeGreaterThanOrEqual(0);
  return idx;
}

describe('AKQ ゲーム（half-street・pot size bet）の解析解と一致する', () => {
  // 古典的な clairvoyance ゲーム: hero = {AA(ナッツ), QQ(ブラフ候補)} 等量、villain = {KK} のみ。
  // villain は check 済みで、hero は check か pot size bet（=all-in）のみ。
  // 解析解（pot 1・bet 1）: AA は常に bet、QQ は 1/2 で bet、KK は 1/2 でコール。
  const board: Card[] = ['2c', '4d', '6h', '8s', 'Jd'];
  const hero: WeightedCombo[] = [
    { cards: ['As', 'Ah'], weight: 1 },
    { cards: ['Qs', 'Qh'], weight: 1 },
  ];
  const villain: WeightedCombo[] = [{ cards: ['Ks', 'Kh'], weight: 1 }];
  const root: RootState = {
    pot: 1,
    toCall: 0,
    stacks: [1, 1],
    villainChecked: true,
    heroCanRaise: true,
    minRaiseInc: 0,
  };
  const config: TreeConfig = { betSizesPot: [1], raiseSizesPot: [], maxRaises: 0 };

  const nodes = buildRiverTree(root, config);
  const input: CfrInput = {
    nodes,
    rootPot: 1,
    combos: [buildComboSet(hero, board), buildComboSet(villain, board)],
  };
  const solution = solveCfr(input, {
    maxIterations: 4000,
    checkEvery: 200,
    targetExploitabilityPctPot: 0.05,
  });

  it('exploitability が閾値まで収束する', () => {
    expect(solution.converged).toBe(true);
    expect(solution.exploitabilityPctPot).toBeLessThanOrEqual(0.05);
  });

  it('均衡頻度: AA bet 100% / QQ bet 50% / KK call 50%', () => {
    const rootNode = nodes[0];
    if (rootNode.kind !== 'decision') throw new Error('root must be decision');
    const betEdge = rootNode.edges.findIndex((e) => e.add > 0);
    const heroStrategy = solution.avgStrategy.get(0)!;
    const aa = classIndex(input.combos[0], 'AA');
    const qq = classIndex(input.combos[0], 'QQ');
    expect(heroStrategy[betEdge][aa]).toBeGreaterThan(0.95);
    expect(heroStrategy[betEdge][qq]).toBeCloseTo(0.5, 1);

    const villainNodeIdx = nodes.findIndex((n) => n.kind === 'decision' && n.actor === 1);
    const villainNode = nodes[villainNodeIdx];
    if (villainNode.kind !== 'decision') throw new Error('unreachable');
    const callEdge = villainNode.edges.findIndex((e) => e.add > 0);
    const kk = classIndex(input.combos[1], 'KK');
    expect(solution.avgStrategy.get(villainNodeIdx)![callEdge][kk]).toBeCloseTo(0.5, 1);
  });

  it('均衡EV: AA の bet は check より +0.5bb、QQ の bet は 0 に無差別', () => {
    const rootNode = nodes[0];
    if (rootNode.kind !== 'decision') throw new Error('unreachable');
    const betEdge = rootNode.edges.findIndex((e) => e.add > 0);
    const checkEdge = rootNode.edges.findIndex((e) => e.action === 'check');
    const values = rootEdgeValues(input, solution.avgStrategy);
    const aa = classIndex(input.combos[0], 'AA');
    const qq = classIndex(input.combos[0], 'QQ');
    // compat = 1（ブロッカーなし）なので値がそのまま EV(bb)
    expect(values[betEdge][aa]).toBeCloseTo(1.5, 1);
    expect(values[checkEdge][aa]).toBeCloseTo(1.0, 1);
    expect(values[betEdge][qq]).toBeCloseTo(0, 1);
    expect(values[checkEdge][qq]).toBeCloseTo(0, 1);
  });
});

describe('支配戦略の検算', () => {
  it('ナッツはベットに直面して fold 頻度 ~0', () => {
    // board QQ776 で hero が QQ… は不可能（ボードと重複）。ナッツ級のフルハウスを持たせる
    const board: Card[] = ['Qc', '7d', '2h', '7s', 'Qd'];
    const hero: WeightedCombo[] = [
      { cards: ['Qs', 'Qh'], weight: 0 }, // board 重複は buildComboSet が除外することの確認を兼ねる
      { cards: ['7h', '7c'], weight: 1 }, // quads
      { cards: ['Ah', 'Kh'], weight: 1 }, // air
      { cards: ['9s', '9h'], weight: 1 }, // bluff catcher
    ];
    const villain: WeightedCombo[] = [
      { cards: ['Ac', 'Qh'], weight: 1 }, // trips... Qh は hero と重複し得るが combo 単位で共存可
      { cards: ['As', 'Kd'], weight: 1 },
      { cards: ['Ts', 'Th'], weight: 1 },
    ];
    // villain が pot(10) の半分 5 を bet 済み: potBefore=15, toCall=5
    const root: RootState = {
      pot: 15,
      toCall: 5,
      stacks: [50, 45],
      villainChecked: false,
      heroCanRaise: true,
      minRaiseInc: 5,
    };
    const nodes = buildRiverTree(root);
    const input: CfrInput = {
      nodes,
      rootPot: 15,
      combos: [buildComboSet(hero, board), buildComboSet(villain, board)],
    };
    const solution = solveCfr(input, {
      maxIterations: 2000,
      checkEvery: 100,
      targetExploitabilityPctPot: 0.25,
    });
    expect(solution.converged).toBe(true);

    const rootNode = nodes[0];
    if (rootNode.kind !== 'decision') throw new Error('unreachable');
    const foldEdge = rootNode.edges.findIndex((e) => e.action === 'fold');
    const quads = classIndex(input.combos[0], '77');
    expect(solution.avgStrategy.get(0)![foldEdge][quads]).toBeLessThan(0.02);

    // fold の EV は定義上 0。ナッツはコール/レイズの EV が正
    const values = rootEdgeValues(input, solution.avgStrategy);
    const compat = compatibleMass(input.combos[0], input.combos[1], input.combos[1].weight);
    const callEdge = rootNode.edges.findIndex((e) => e.action === 'call');
    expect(values[foldEdge][quads] / compat[quads]).toBeCloseTo(0, 6);
    expect(values[callEdge][quads] / compat[quads]).toBeGreaterThan(10);
  });
});

describe('終端評価（sort + prefix sum）', () => {
  /** テスト内にのみ置く素朴 O(H×V) 実装（§8.2） */
  function naiveShowdownValues(
    own: ComboSet,
    opp: ComboSet,
    oppReach: Float64Array,
    pot: number,
    ownInvested: number,
  ): Float64Array {
    const out = new Float64Array(own.n);
    for (let i = 0; i < own.n; i++) {
      let acc = 0;
      for (let j = 0; j < opp.n; j++) {
        const shares =
          own.cardA[i] === opp.cardA[j] ||
          own.cardA[i] === opp.cardB[j] ||
          own.cardB[i] === opp.cardA[j] ||
          own.cardB[i] === opp.cardB[j];
        // 同一2枚のコンボ同士は「両カード共有」だが実際には共存不能なので除外で正しい
        if (shares) continue;
        const si = own.strength[i];
        const sj = opp.strength[j];
        const share = si > sj ? 1 : si === sj ? 0.5 : 0;
        acc += oppReach[j] * (pot * share - ownInvested);
      }
      out[i] = acc;
    }
    return out;
  }

  it('素朴 O(H×V) 実装と一致する（ブロッカー・タイ・重み込み）', () => {
    const rng = makeRng(2026);
    const board: Card[] = ['Ah', 'Td', '9c', '5s', '2d'];
    const classes = ['AA', 'KK', 'TT', '99', 'AKs', 'AKo', 'KQs', 'JQs', 'T9s', '87s', '55', '22'];
    const combos = (): WeightedCombo[] =>
      classes.flatMap((hc) => handClassToCombos(hc).map((cards) => ({ cards, weight: rng() })));
    const own = buildComboSet(combos(), board);
    const opp = buildComboSet(combos(), board);
    const reach = new Float64Array(opp.n);
    for (let j = 0; j < opp.n; j++) reach[j] = rng();

    const fast = showdownValues(own, opp, reach, 12.5, 4);
    const naive = naiveShowdownValues(own, opp, reach, 12.5, 4);
    expect(fast.length).toBe(naive.length);
    for (let i = 0; i < fast.length; i++) {
      expect(fast[i]).toBeCloseTo(naive[i], 8);
    }
  });

  it('カードリムーバル: ブロッカーを含む小レンジで手計算と一致', () => {
    const board: Card[] = ['Kh', '8d', '4c', '3s', '2h'];
    // own: AsKs。opp: {AsQs(As 共有・除外), AcQc(共存), KsKd(Ks 共有・除外)}
    const own = buildComboSet([{ cards: ['As', 'Ks'], weight: 1 }], board);
    const opp = buildComboSet(
      [
        { cards: ['As', 'Qs'], weight: 0.7 },
        { cards: ['Ac', 'Qc'], weight: 0.5 },
        { cards: ['Ks', 'Kd'], weight: 0.9 },
      ],
      board,
    );
    const compat = compatibleMass(own, opp, opp.weight);
    expect(compat[0]).toBeCloseTo(0.5, 9);

    // AsKs(トップペア) vs AcQc(エースハイ) → 勝ち。pot 10, invested 2
    // v = 10 × 0.5(reach) × 1(win) - 2 × 0.5 = 4
    const v = showdownValues(own, opp, opp.weight, 10, 2);
    expect(v[0]).toBeCloseTo(4, 9);
  });
});

describe('exploitability 収束（実スポット規模）', () => {
  it('広いレンジ同士の bet 直面スポットが規定反復内に収束する', () => {
    const rng = makeRng(7);
    const board: Card[] = ['Js', '8h', '5d', 'Kc', '2s'];
    const someClasses = [
      'AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55',
      'AKs', 'AKo', 'AQs', 'AQo', 'AJs', 'ATs', 'KQs', 'KQo', 'KJs', 'QJs',
      'JTs', 'T9s', '98s', '87s', '76s', '65s', 'A5s', 'A4s',
    ];
    const range = (): WeightedCombo[] =>
      someClasses.flatMap((hc) =>
        handClassToCombos(hc).map((cards) => ({ cards, weight: 0.25 + 0.75 * rng() })),
      );
    const root: RootState = {
      pot: 13,
      toCall: 6.5,
      stacks: [90, 85],
      villainChecked: false,
      heroCanRaise: true,
      minRaiseInc: 6.5,
    };
    const nodes = buildRiverTree(root);
    const input: CfrInput = {
      nodes,
      rootPot: 13,
      combos: [buildComboSet(range(), board), buildComboSet(range(), board)],
    };
    const solution = solveCfr(input, {
      maxIterations: 1000,
      checkEvery: 100,
      targetExploitabilityPctPot: 0.5,
    });
    expect(solution.converged).toBe(true);
    expect(solution.iterations).toBeLessThanOrEqual(1000);

    // 平均戦略の各コンボ頻度は正規化されている
    const rootStrategy = solution.avgStrategy.get(0)!;
    for (let h = 0; h < input.combos[0].n; h += 37) {
      let total = 0;
      for (const arr of rootStrategy) total += arr[h];
      expect(total).toBeCloseTo(1, 6);
    }

    // 定和性の検算: 両者 BR 合計は rootPot + 2×(誤差) に一致している
    const totals = bestResponseTotals(input, solution.avgStrategy);
    expect(totals.brValue[0] + totals.brValue[1]).toBeGreaterThanOrEqual(input.rootPot - 1e-6);
  });
});

describe('buildRiverTree', () => {
  it('check 済み相手への判断: check→showdown / bet→villain 応答', () => {
    const nodes = buildRiverTree(
      { pot: 10, toCall: 0, stacks: [50, 50], villainChecked: true, heroCanRaise: true, minRaiseInc: 0 },
    );
    const root = nodes[0];
    if (root.kind !== 'decision') throw new Error('unreachable');
    expect(root.actor).toBe(0);
    const check = root.edges.find((e) => e.action === 'check')!;
    expect(nodes[check.child].kind).toBe('showdown');
    // bet 33% / 75% / all-in の3サイズ
    const betAdds = root.edges.filter((e) => e.add > 0).map((e) => e.add);
    expect(betAdds.length).toBe(3);
    expect(betAdds[0]).toBeCloseTo(3.3, 9);
    expect(betAdds[1]).toBeCloseTo(7.5, 9);
    expect(betAdds[2]).toBeCloseTo(50, 9);
  });

  it('bet 直面: fold/call/raise(1回 cap)。raise 後の相手は fold/call のみ', () => {
    const nodes = buildRiverTree(
      { pot: 15, toCall: 5, stacks: [60, 55], villainChecked: false, heroCanRaise: true, minRaiseInc: 5 },
    );
    const root = nodes[0];
    if (root.kind !== 'decision') throw new Error('unreachable');
    const actions = root.edges.map((e) => e.action);
    expect(actions).toContain('fold');
    expect(actions).toContain('call');
    expect(actions.filter((a) => a === 'raise' || a === 'allin').length).toBeGreaterThan(0);

    const raiseEdge = root.edges.find((e) => e.action === 'raise')!;
    // raise 0.75 × potAfterCall(20) = 15 増分 → add = 5 + 15 = 20
    expect(raiseEdge.add).toBeCloseTo(20, 9);
    const respond = nodes[raiseEdge.child];
    if (respond.kind !== 'decision') throw new Error('unreachable');
    expect(respond.actor).toBe(1);
    // cap により再レイズなし（all-in 含めエッジは fold/call 系のみ）
    expect(respond.edges.every((e) => e.action === 'fold' || e.action === 'call' || e.add <= 15)).toBe(true);
    expect(respond.edges.filter((e) => e.action === 'raise').length).toBe(0);
  });

  it('short all-in 非再オープン（heroCanRaise=false）では raise エッジを作らない', () => {
    const nodes = buildRiverTree(
      { pot: 20, toCall: 3, stacks: [40, 0], villainChecked: false, heroCanRaise: false, minRaiseInc: 0 },
    );
    const root = nodes[0];
    if (root.kind !== 'decision') throw new Error('unreachable');
    expect(root.edges.map((e) => e.action).sort()).toEqual(['call', 'fold']);
  });
});
