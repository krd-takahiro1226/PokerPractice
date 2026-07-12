import type { Card } from '../../src/core/cards';
import { cardsToHandClass, type HandClass } from '../../src/core/handNotation';

// TexasSolver console 版の dump JSON パーサ（docs/SOLVER-REVIEW-DESIGN.md §12.2.2, §12.4）。
//
// 金額規約（実証済み・凍結）: BET/RAISE ラベルの数値は「そのアクションでの追加投入額」その
// ものである（call 分も含む raise の場合はコール込みの合計）。TexasSolver
// `GameTree.cpp::get_possible_bets` を読むと、内部的には
//   amount = round_nearest(pct * max(ip_commit, oop_commit) * 2, bb)
//   RAISE の場合 amount += (相手のcommit - 自分のcommit)
//   閾値超過時は amount = 残りスタック（＝そのままallin）
// で算出されるが、この「amount」は commit の基準点（set_pot による初期オフセット）に依らず
// 常に「このアクションでの追加投入額」の絶対値になる。したがって本パーサは solver 内部の
// pot_local 式を再現する必要はなく、ラベルの数値をそのまま additional として使い、
// pot/commit は flop 開始時点（pot=potBB, commit=[0,0]）からの独自リプレイで積算する
// （line トークンの pct は「街開始からの実ポット」基準で、既存 currentStreetLine() と同じ定義）。
//
// player フィールド: 0=IP, 1=OOP（実証済み。Rule::get_commit(0)=ip_commit,
// get_commit(1)=oop_commit と、HU postflop で OOP が先手というポーカーの慣行から確認）。

export type SolverStrategy = { actions: string[]; strategy: Record<string, number[]> };

export type SolverNode = {
  node_type: string;
  actions?: string[];
  childrens?: Record<string, SolverNode>;
  player?: number;
  strategy?: SolverStrategy;
  [key: string]: unknown;
};

export type PresolveNodeEntry = {
  actor: 'oop' | 'ip';
  actions: string[];
  strat: Record<HandClass, number[]>;
};

export type ParseConfig = {
  /** flop 開始時点のポット（set_pot と同じ単位。scale integer でも bb 実数でも比率は不変） */
  potBB: number;
  /** 各プレイヤーの街開始時点の残りスタック（set_effective_stack と同じ単位） */
  effStackBB: number;
};

const EPS = 1e-6;
/** allin 判定の許容誤差。round_nearest によるサブ単位の丸め誤差を吸収する */
const ALLIN_EPS = 0.5;
const BET_RE = /^(BET|RAISE) ([\d.]+)$/;

function resolveToken(
  label: string,
  potBefore: number,
  ownCommit: number,
  oppCommit: number,
  effStackBB: number,
): { token: string; additional: number } {
  if (label === 'CHECK') return { token: 'x', additional: 0 };
  if (label === 'FOLD') return { token: 'f', additional: 0 };
  if (label === 'CALL') return { token: 'c', additional: oppCommit - ownCommit };

  const m = label.match(BET_RE);
  if (!m) throw new Error(`presolve parse: unrecognized action label "${label}"`);
  const additional = Number(m[2]);
  const remaining = effStackBB - ownCommit;
  if (additional >= remaining - ALLIN_EPS) return { token: 'a', additional: remaining };
  const pct = potBefore > EPS ? Math.round((additional / potBefore) * 100) : 0;
  return { token: `${m[1] === 'BET' ? 'b' : 'r'}${pct}`, additional };
}

/** combo（"AhKs"）ごとの頻度ベクトルを handClass 単位に単純平均集計する（クラス内一様重み）。 */
function aggregateToHandClass(actionCount: number, comboStrategy: Record<string, number[]>): Record<HandClass, number[]> {
  const sums = new Map<HandClass, number[]>();
  const counts = new Map<HandClass, number>();
  for (const [combo, freqs] of Object.entries(comboStrategy)) {
    if (freqs.length !== actionCount) {
      throw new Error(`presolve parse: strategy vector length mismatch for combo ${combo}`);
    }
    const c1 = combo.slice(0, 2) as Card;
    const c2 = combo.slice(2, 4) as Card;
    const hc = cardsToHandClass(c1, c2);
    const sum = sums.get(hc) ?? new Array(actionCount).fill(0);
    for (let i = 0; i < actionCount; i++) sum[i] += freqs[i];
    sums.set(hc, sum);
    counts.set(hc, (counts.get(hc) ?? 0) + 1);
  }
  const out: Record<HandClass, number[]> = {};
  for (const [hc, sum] of sums) {
    const n = counts.get(hc)!;
    out[hc] = sum.map((v) => Math.round((v / n) * 1000) / 1000);
  }
  return out;
}

/** flop ストリートの全意思決定ノード（line トークン深さ3まで）を抽出する（§12.2.2, §12.4）。
 *  root は flop の最初の意思決定ノード（OOP 先手・line=''）。dump_rounds=1 で得た JSON を渡す。 */
export function parseFlopTree(root: SolverNode, cfg: ParseConfig): Record<string, PresolveNodeEntry> {
  const out: Record<string, PresolveNodeEntry> = {};
  const MAX_DEPTH = 3;

  function visit(node: SolverNode, pathShort: string[], pot: number, commit: [number, number]): void {
    if (node.node_type !== 'action_node') return;
    if (pathShort.length > MAX_DEPTH) return;
    const player = node.player;
    if (player !== 0 && player !== 1) {
      throw new Error(`presolve parse: action_node missing valid player at line "${pathShort.join('-')}"`);
    }
    if (!node.actions || !node.strategy) {
      throw new Error(`presolve parse: action_node missing actions/strategy at line "${pathShort.join('-')}"`);
    }
    if (JSON.stringify(node.strategy.actions) !== JSON.stringify(node.actions)) {
      throw new Error(`presolve parse: strategy.actions order mismatch at line "${pathShort.join('-')}"`);
    }

    const actor: 'oop' | 'ip' = player === 1 ? 'oop' : 'ip';
    const ownCommit = commit[player];
    const oppCommit = commit[1 - player];

    const resolved = node.actions.map((label) => resolveToken(label, pot, ownCommit, oppCommit, cfg.effStackBB));
    const shortActions = resolved.map((r) => r.token);
    const strat = aggregateToHandClass(node.actions.length, node.strategy.strategy);

    const line = pathShort.join('-');
    out[line] = { actor, actions: shortActions, strat };

    if (pathShort.length === MAX_DEPTH) return;

    node.actions.forEach((label, i) => {
      if (label === 'FOLD') return; // 終端（fold）。展開しない
      const child = node.childrens?.[label];
      if (!child || child.node_type !== 'action_node') return; // chance_node = このストリート終了
      const { token, additional } = resolved[i];
      const nextCommit: [number, number] = [...commit];
      nextCommit[player] += additional;
      visit(child, [...pathShort, token], pot + additional, nextCommit);
    });
  }

  visit(root, [], cfg.potBB, [0, 0]);
  return out;
}

/** stdout から最終 "Total exploitability X precent" を抽出する。 */
export function parseFinalExploitability(stdout: string): number | null {
  const matches = [...stdout.matchAll(/Total exploitability ([\d.]+) precent/g)];
  if (matches.length === 0) return null;
  return Number(matches[matches.length - 1][1]);
}
