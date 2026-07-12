import type { ComboSet, EvalView } from './terminal';
import { chanceNodeValues, foldValues, showdownNodeValues } from './terminal';
import type { PlayerIdx, TreeNode } from './tree';
import { bestResponseTotals } from './exploit';

// vector CFR+（docs/SOLVER-REVIEW-DESIGN.md §5.2, §5.3）:
// 全コンボ一括の regret matching+、交互更新、線形重み付き平均戦略。
// 値は counterfactual value（相手 reach で重み付けた期待獲得額）。
// turn 木（L2）は chance node で river 分岐し、showdown は river 別 EvalView で評価する。

export type CfrInput = {
  nodes: TreeNode[];
  rootPot: number;
  /** [hero, villain] */
  combos: [ComboSet, ComboSet];
  /** turn 木のみ: cardId(river) → [hero視点, villain視点] の評価ビュー */
  views?: Map<number, [EvalView, EvalView]>;
};

export type CfrOptions = {
  maxIterations: number;
  /** exploitability を計測する間隔（反復数） */
  checkEvery: number;
  /** この % of pot を下回ったら収束打ち切り */
  targetExploitabilityPctPot: number;
  /** 反復ごとの進捗通知（turn 解析の進捗バー用） */
  onIteration?: (iteration: number, maxIterations: number) => void;
};

export const DEFAULT_CFR_OPTIONS: CfrOptions = {
  maxIterations: 2000,
  checkEvery: 100,
  targetExploitabilityPctPot: 0.25,
};

/** turn 木用: 反復コストが river の約48倍のため、反復上限と収束閾値を緩める（§5.3） */
export const TURN_CFR_OPTIONS: CfrOptions = {
  maxIterations: 1000,
  checkEvery: 50,
  targetExploitabilityPctPot: 0.5,
};

/** decision node index → edge → combo ごとの頻度 */
export type StrategyMap = Map<number, Float64Array[]>;

export type CfrSolution = {
  avgStrategy: StrategyMap;
  iterations: number;
  exploitabilityPctPot: number;
  converged: boolean;
};

type Tables = {
  regrets: StrategyMap;
  stratSum: StrategyMap;
};

function decisionNodeArrays(nodes: TreeNode[], combos: [ComboSet, ComboSet]): Tables {
  const regrets: StrategyMap = new Map();
  const stratSum: StrategyMap = new Map();
  nodes.forEach((node, idx) => {
    if (node.kind !== 'decision') return;
    const n = combos[node.actor].n;
    regrets.set(idx, node.edges.map(() => new Float64Array(n)));
    stratSum.set(idx, node.edges.map(() => new Float64Array(n)));
  });
  return { regrets, stratSum };
}

/** regret matching+: 正の累積 regret に比例。全て 0 なら一様。out は edge×combo。 */
function matchStrategy(regrets: Float64Array[], n: number): Float64Array[] {
  const E = regrets.length;
  const out = regrets.map(() => new Float64Array(n));
  for (let h = 0; h < n; h++) {
    let sum = 0;
    for (let e = 0; e < E; e++) sum += regrets[e][h];
    if (sum > 0) {
      for (let e = 0; e < E; e++) out[e][h] = regrets[e][h] / sum;
    } else {
      for (let e = 0; e < E; e++) out[e][h] = 1 / E;
    }
  }
  return out;
}

export function normalizedAverageStrategy(stratSum: StrategyMap, input: CfrInput): StrategyMap {
  const avg: StrategyMap = new Map();
  for (const [idx, sums] of stratSum) {
    const node = input.nodes[idx];
    if (node.kind !== 'decision') continue;
    const n = input.combos[node.actor].n;
    const E = sums.length;
    const arrs = sums.map(() => new Float64Array(n));
    for (let h = 0; h < n; h++) {
      let total = 0;
      for (let e = 0; e < E; e++) total += sums[e][h];
      for (let e = 0; e < E; e++) arrs[e][h] = total > 0 ? sums[e][h] / total : 1 / E;
    }
    avg.set(idx, arrs);
  }
  return avg;
}

export function solveCfr(input: CfrInput, options: CfrOptions = DEFAULT_CFR_OPTIONS): CfrSolution {
  const { nodes, combos } = input;
  const { regrets, stratSum } = decisionNodeArrays(nodes, combos);

  const traverse = (
    nodeIdx: number,
    u: PlayerIdx,
    reachOwn: Float64Array,
    reachOpp: Float64Array,
    t: number,
  ): Float64Array => {
    const node = nodes[nodeIdx];
    const own = combos[u];
    const opp = combos[(1 - u) as PlayerIdx];

    if (node.kind === 'fold') {
      const gain = node.winner === u ? node.pot - node.invested[u] : -node.invested[u];
      return foldValues(own, opp, reachOpp, gain);
    }
    if (node.kind === 'showdown') {
      return showdownNodeValues(combos, input.views, node, u, reachOpp);
    }
    if (node.kind === 'chance') {
      return chanceNodeValues(combos, node, u, reachOwn, reachOpp, (child, rOwn, rOpp) =>
        traverse(child, u, rOwn!, rOpp, t),
      );
    }

    const E = node.edges.length;
    if (node.actor === u) {
      const nodeRegrets = regrets.get(nodeIdx)!;
      const nodeStratSum = stratSum.get(nodeIdx)!;
      const sigma = matchStrategy(nodeRegrets, own.n);
      const childValues: Float64Array[] = new Array(E);
      for (let e = 0; e < E; e++) {
        const childReachOwn = new Float64Array(own.n);
        for (let h = 0; h < own.n; h++) childReachOwn[h] = reachOwn[h] * sigma[e][h];
        childValues[e] = traverse(node.edges[e].child, u, childReachOwn, reachOpp, t);
      }
      const v = new Float64Array(own.n);
      for (let h = 0; h < own.n; h++) {
        let acc = 0;
        for (let e = 0; e < E; e++) acc += sigma[e][h] * childValues[e][h];
        v[h] = acc;
      }
      for (let e = 0; e < E; e++) {
        const r = nodeRegrets[e];
        const ss = nodeStratSum[e];
        const cv = childValues[e];
        const sg = sigma[e];
        for (let h = 0; h < own.n; h++) {
          r[h] = Math.max(0, r[h] + cv[h] - v[h]); // regret matching+
          ss[h] += t * reachOwn[h] * sg[h]; // 線形重み付き平均
        }
      }
      return v;
    }

    // 相手ノード: 相手の現在戦略で reach を分配し、値は総和
    const oppRegrets = regrets.get(nodeIdx)!;
    const sigmaOpp = matchStrategy(oppRegrets, opp.n);
    const v = new Float64Array(own.n);
    for (let e = 0; e < E; e++) {
      const childReachOpp = new Float64Array(opp.n);
      for (let h = 0; h < opp.n; h++) childReachOpp[h] = reachOpp[h] * sigmaOpp[e][h];
      const cv = traverse(node.edges[e].child, u, reachOwn, childReachOpp, t);
      for (let h = 0; h < own.n; h++) v[h] += cv[h];
    }
    return v;
  };

  let iterations = 0;
  let exploitabilityPctPot = Number.POSITIVE_INFINITY;
  for (let t = 1; t <= options.maxIterations; t++) {
    traverse(0, 0, combos[0].weight, combos[1].weight, t);
    traverse(0, 1, combos[1].weight, combos[0].weight, t);
    iterations = t;
    options.onIteration?.(t, options.maxIterations);
    if (t % options.checkEvery === 0 || t === options.maxIterations) {
      const avg = normalizedAverageStrategy(stratSum, input);
      exploitabilityPctPot = bestResponseTotals(input, avg).exploitabilityPctPot;
      if (exploitabilityPctPot <= options.targetExploitabilityPctPot) break;
    }
  }

  return {
    avgStrategy: normalizedAverageStrategy(stratSum, input),
    iterations,
    exploitabilityPctPot,
    converged: exploitabilityPctPot <= options.targetExploitabilityPctPot,
  };
}
