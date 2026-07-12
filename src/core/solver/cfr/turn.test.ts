import { describe, it, expect } from 'vitest';
import { makeDeck, removeCards, type Card } from '../../cards';
import { handClassToCombos } from '../../handNotation';
import { evaluate7 } from '../../evaluator';
import {
  buildComboSet,
  buildEvalView,
  cardId,
  showdownValuesView,
  type EvalView,
  type WeightedCombo,
} from './terminal';
import { buildTurnTree, TURN_TREE_CONFIG, type TurnRootState } from './tree';
import { solveCfr, TURN_CFR_OPTIONS, type CfrInput } from './cfr';
import { rootEdgeValues } from './exploit';

// turn(L2) 木・CFR層のテスト（docs/SOLVER-REVIEW-DESIGN.md §5.3）。
// river 版（cfr.test.ts）と同じ検証パターン（構造・素朴実装との一致・支配戦略・収束）を
// chance node（river 分岐）を含む turn 木に対して行う。均衡頻度の数値スナップショットは書かない。

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

describe('buildTurnTree の構造', () => {
  const board: Card[] = ['9h', '5d', '2c', 'Kc'];
  const rivers = removeCards(makeDeck(), board);

  it('check-check によるラウンド終了は chance node（48分岐・pairRivers=44）になる', () => {
    const root: TurnRootState = {
      pot: 10,
      toCall: 0,
      stacks: [50, 50],
      villainChecked: true,
      heroCanRaise: true,
      minRaiseInc: 0,
      riverFirstActor: 0,
    };
    const nodes = buildTurnTree(root, rivers);
    const rootNode = nodes[0];
    if (rootNode.kind !== 'decision') throw new Error('unreachable');
    const checkEdge = rootNode.edges.find((e) => e.action === 'check')!;
    const chance = nodes[checkEdge.child];
    expect(chance.kind).toBe('chance');
    if (chance.kind !== 'chance') throw new Error('unreachable');
    expect(chance.children.length).toBe(48);
    expect(chance.pairRivers).toBe(44);
  });

  it('call によるラウンド終了（両者スタック残あり）も chance node になる', () => {
    const root: TurnRootState = {
      pot: 15,
      toCall: 5,
      stacks: [60, 55],
      villainChecked: false,
      heroCanRaise: true,
      minRaiseInc: 5,
      riverFirstActor: 0,
    };
    const nodes = buildTurnTree(root, rivers);
    const rootNode = nodes[0];
    if (rootNode.kind !== 'decision') throw new Error('unreachable');
    const callEdge = rootNode.edges.find((e) => e.action === 'call')!;
    const chance = nodes[callEdge.child];
    expect(chance.kind).toBe('chance');
    if (chance.kind !== 'chance') throw new Error('unreachable');
    expect(chance.children.length).toBe(48);
    expect(chance.pairRivers).toBe(44);
  });

  it('両者 all-in のラウンド終了は children が全て river 注釈付き showdown になる', () => {
    const root: TurnRootState = {
      pot: 10,
      toCall: 5,
      stacks: [5, 0],
      villainChecked: false,
      heroCanRaise: true,
      minRaiseInc: 5,
      riverFirstActor: 0,
    };
    const nodes = buildTurnTree(root, rivers);
    const rootNode = nodes[0];
    if (rootNode.kind !== 'decision') throw new Error('unreachable');
    const allinEdge = rootNode.edges.find((e) => e.action === 'allin')!;
    const chance = nodes[allinEdge.child];
    expect(chance.kind).toBe('chance');
    if (chance.kind !== 'chance') throw new Error('unreachable');
    expect(chance.children.length).toBe(48);
    for (const { child } of chance.children) {
      const n = nodes[child];
      expect(n.kind).toBe('showdown');
      if (n.kind !== 'showdown') throw new Error('unreachable');
      expect(n.river).toBeDefined();
    }
  });

  it.each([0, 1] as const)(
    'river サブツリーの初手 actor が riverFirstActor=%i と一致する',
    (riverFirstActor) => {
      const root: TurnRootState = {
        pot: 10,
        toCall: 0,
        stacks: [50, 50],
        villainChecked: true,
        heroCanRaise: true,
        minRaiseInc: 0,
        riverFirstActor,
      };
      const nodes = buildTurnTree(root, rivers);
      const rootNode = nodes[0];
      if (rootNode.kind !== 'decision') throw new Error('unreachable');
      const checkEdge = rootNode.edges.find((e) => e.action === 'check')!;
      const chance = nodes[checkEdge.child];
      if (chance.kind !== 'chance') throw new Error('unreachable');
      for (const { child } of chance.children) {
        const n = nodes[child];
        expect(n.kind).toBe('decision');
        if (n.kind !== 'decision') throw new Error('unreachable');
        expect(n.actor).toBe(riverFirstActor);
      }
    },
  );
});

describe('showdownValuesView（turn: river 別 EvalView）', () => {
  it('素朴 O(H×V) 実装（river 別評価・river衝突コンボ除外）と一致する', () => {
    const rng = makeRng(4040);
    const board: Card[] = ['Ah', 'Td', '9c', '5s'];
    const heroClasses = ['AA', 'KQs', 'JTs', '87s'];
    const villClasses = ['KK', 'QQ', 'AJo', '76s'];
    const heroCombos: WeightedCombo[] = heroClasses.flatMap((hc) =>
      handClassToCombos(hc).map((cards) => ({ cards, weight: rng() })),
    );
    const villCombos: WeightedCombo[] = villClasses.flatMap((hc) =>
      handClassToCombos(hc).map((cards) => ({ cards, weight: rng() })),
    );
    const heroSet = buildComboSet(heroCombos, board);
    const villSet = buildComboSet(villCombos, board);
    const oppReach = villSet.weight;

    const candidateRivers = removeCards(makeDeck(), board);
    const testRivers: Card[] = [];
    for (let k = 0; k < 4; k++) {
      testRivers.push(candidateRivers[Math.floor(rng() * candidateRivers.length)]);
    }

    const pot = 24;
    const ownInvested = 6;

    // テスト内にのみ置く素朴 O(H×V) 実装（§8.2）。river ごとに own/opp の evaluate7 を計算し、
    // river・own/opp 間でカードを共有するコンボはスキップする。
    function naiveTurnShowdownValues(river: Card): Float64Array {
      const riverId = cardId(river);
      const out = new Float64Array(heroSet.n);
      for (let i = 0; i < heroSet.n; i++) {
        if (heroSet.cardA[i] === riverId || heroSet.cardB[i] === riverId) continue;
        const heroStrength = evaluate7([heroSet.cards[i][0], heroSet.cards[i][1], ...board, river]);
        let acc = 0;
        for (let j = 0; j < villSet.n; j++) {
          const r = oppReach[j];
          if (r === 0) continue;
          if (villSet.cardA[j] === riverId || villSet.cardB[j] === riverId) continue;
          const shares =
            heroSet.cardA[i] === villSet.cardA[j] ||
            heroSet.cardA[i] === villSet.cardB[j] ||
            heroSet.cardB[i] === villSet.cardA[j] ||
            heroSet.cardB[i] === villSet.cardB[j];
          if (shares) continue;
          const villStrength = evaluate7([villSet.cards[j][0], villSet.cards[j][1], ...board, river]);
          const share = heroStrength > villStrength ? 1 : heroStrength === villStrength ? 0.5 : 0;
          acc += r * (pot * share - ownInvested);
        }
        out[i] = acc;
      }
      return out;
    }

    for (const river of testRivers) {
      const heroView = buildEvalView(heroSet, board, river);
      const villView = buildEvalView(villSet, board, river);
      const fast = showdownValuesView(heroSet, villSet, heroView, villView, oppReach, pot, ownInvested);
      const naive = naiveTurnShowdownValues(river);
      expect(fast.length).toBe(naive.length);
      for (let i = 0; i < fast.length; i++) {
        expect(fast[i]).toBeCloseTo(naive[i], 8);
      }
    }
  });
});

describe('all-in call の EV 整合性', () => {
  it('rootEdgeValues の call エッジ EV が手計算（44 river 平均）と一致する', () => {
    const board: Card[] = ['9h', '5d', '2c', 'Kc'];
    const heroCombos: WeightedCombo[] = handClassToCombos('AKs').map((cards) => ({ cards, weight: 1 }));
    const villCombos: WeightedCombo[] = [
      ...handClassToCombos('QQ').map((cards) => ({ cards, weight: 1 })),
      ...handClassToCombos('JJ').map((cards) => ({ cards, weight: 1 })),
    ];
    const heroSet = buildComboSet(heroCombos, board);
    const villSet = buildComboSet(villCombos, board);

    const potBefore = 20;
    const heroStack = 15; // toCall === heroStack: hero は fold/all-in call のみ、villain は既に all-in
    const root: TurnRootState = {
      pot: potBefore,
      toCall: heroStack,
      stacks: [heroStack, 0],
      villainChecked: false,
      heroCanRaise: true,
      minRaiseInc: heroStack,
      riverFirstActor: 0,
    };
    const rivers = removeCards(makeDeck(), board);
    const views = new Map<number, [EvalView, EvalView]>();
    for (const river of rivers) {
      views.set(cardId(river), [buildEvalView(heroSet, board, river), buildEvalView(villSet, board, river)]);
    }
    const nodes = buildTurnTree(root, rivers, TURN_TREE_CONFIG);
    const input: CfrInput = { nodes, rootPot: potBefore, combos: [heroSet, villSet], views };
    const solution = solveCfr(input, TURN_CFR_OPTIONS);

    const rootNode = nodes[0];
    if (rootNode.kind !== 'decision') throw new Error('unreachable');
    // 両者スタックが尽きるため fold/all-in のみのシンプルな木になっているはず
    expect(rootNode.edges.map((e) => e.action).sort()).toEqual(['allin', 'fold']);
    const callEdgeIdx = rootNode.edges.findIndex((e) => e.action === 'allin');
    const edgeValues = rootEdgeValues(input, solution.avgStrategy);

    const potAtShowdown = potBefore + heroStack;
    for (let hi = 0; hi < heroSet.n; hi++) {
      const heroCards = heroSet.cards[hi];
      let expected = 0;
      for (let vj = 0; vj < villSet.n; vj++) {
        const villCards = villSet.cards[vj];
        const shares =
          heroCards[0] === villCards[0] ||
          heroCards[0] === villCards[1] ||
          heroCards[1] === villCards[0] ||
          heroCards[1] === villCards[1];
        if (shares) continue; // カード衝突ペアは除外（両立しない）
        let sum = 0;
        let count = 0;
        for (const river of rivers) {
          if (heroCards.includes(river) || villCards.includes(river)) continue;
          count++;
          const heroStrength = evaluate7([heroCards[0], heroCards[1], ...board, river]);
          const villStrength = evaluate7([villCards[0], villCards[1], ...board, river]);
          const share = heroStrength > villStrength ? 1 : heroStrength === villStrength ? 0.5 : 0;
          sum += potAtShowdown * share - heroStack;
        }
        expect(count).toBe(44);
        expected += villSet.weight[vj] * (sum / count);
      }
      const actual = edgeValues[callEdgeIdx][hi];
      if (Math.abs(expected) < 1e-9) {
        expect(actual).toBeCloseTo(0, 6);
      } else {
        expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(1e-6);
      }
    }
  });
});

describe('支配戦略: ナッツ級 vs air-only レンジ', () => {
  it('turn の bet に直面した hero（trip aces）の fold 頻度 < 0.05', () => {
    // board Ac Kd 8s 2c + hero AsAd = 全44riverのうち40riverで勝つトリップエース級
    // （4d3h/5h4s は wheel straight が完成する river(5x/3x 各4枚)でのみ逆転）
    const board: Card[] = ['Ac', 'Kd', '8s', '2c'];
    const heroCombos: WeightedCombo[] = [{ cards: ['As', 'Ad'], weight: 1 }];
    const villCombos: WeightedCombo[] = [
      { cards: ['4d', '3h'], weight: 1 }, // air（ペア無し・フラッシュドロー無し）
      { cards: ['5h', '4s'], weight: 1 }, // air（ペア無し・フラッシュドロー無し）
    ];
    const heroSet = buildComboSet(heroCombos, board);
    const villSet = buildComboSet(villCombos, board);

    const root: TurnRootState = {
      pot: 15,
      toCall: 5,
      stacks: [90, 85],
      villainChecked: false,
      heroCanRaise: true,
      minRaiseInc: 5,
      riverFirstActor: 0,
    };
    const rivers = removeCards(makeDeck(), board);
    const views = new Map<number, [EvalView, EvalView]>();
    for (const river of rivers) {
      views.set(cardId(river), [buildEvalView(heroSet, board, river), buildEvalView(villSet, board, river)]);
    }
    const nodes = buildTurnTree(root, rivers, TURN_TREE_CONFIG);
    const input: CfrInput = { nodes, rootPot: 15, combos: [heroSet, villSet], views };
    const solution = solveCfr(input, TURN_CFR_OPTIONS);
    expect(solution.converged).toBe(true);

    const rootNode = nodes[0];
    if (rootNode.kind !== 'decision') throw new Error('unreachable');
    const foldEdge = rootNode.edges.findIndex((e) => e.action === 'fold');
    const heroStrategy = solution.avgStrategy.get(0)!;
    expect(heroStrategy[foldEdge][0]).toBeLessThan(0.05);
  });
});

describe('exploitability 収束（turn スポット・小規模レンジ）', () => {
  it(
    '小さめの現実的レンジでの turn ベットスポットが規定反復内に収束する',
    { timeout: 60000 },
    () => {
      const rng = makeRng(99);
      // board のランク(J,8,5,2)を避けたクラス選定で combo 数の予期しない削れを防ぐ
      const board: Card[] = ['Js', '8h', '5d', '2c'];
      const heroClasses = ['AA', 'KK', 'QQ', 'AKs', 'AQs', 'T9s'];
      const villClasses = ['TT', '99', '77', 'KQs', 'KTs', 'QTs'];
      const heroCombos: WeightedCombo[] = heroClasses.flatMap((hc) =>
        handClassToCombos(hc).map((cards) => ({ cards, weight: 0.3 + 0.7 * rng() })),
      );
      const villCombos: WeightedCombo[] = villClasses.flatMap((hc) =>
        handClassToCombos(hc).map((cards) => ({ cards, weight: 0.3 + 0.7 * rng() })),
      );
      const heroSet = buildComboSet(heroCombos, board);
      const villSet = buildComboSet(villCombos, board);
      expect(heroSet.n).toBeGreaterThanOrEqual(30);
      expect(heroSet.n).toBeLessThanOrEqual(80);
      expect(villSet.n).toBeGreaterThanOrEqual(30);
      expect(villSet.n).toBeLessThanOrEqual(80);

      const root: TurnRootState = {
        pot: 12,
        toCall: 6,
        stacks: [80, 75],
        villainChecked: false,
        heroCanRaise: true,
        minRaiseInc: 6,
        riverFirstActor: 0,
      };
      const rivers = removeCards(makeDeck(), board);
      const views = new Map<number, [EvalView, EvalView]>();
      for (const river of rivers) {
        views.set(cardId(river), [buildEvalView(heroSet, board, river), buildEvalView(villSet, board, river)]);
      }
      const nodes = buildTurnTree(root, rivers, TURN_TREE_CONFIG);
      const input: CfrInput = { nodes, rootPot: 12, combos: [heroSet, villSet], views };
      const solution = solveCfr(input, TURN_CFR_OPTIONS);
      expect(solution.converged).toBe(true);
      expect(solution.exploitabilityPctPot).toBeLessThanOrEqual(TURN_CFR_OPTIONS.targetExploitabilityPctPot);
    },
  );
});
