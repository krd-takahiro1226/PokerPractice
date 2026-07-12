// river/turn HU サブゲームのゲーム木構築（docs/SOLVER-REVIEW-DESIGN.md §5.2, §5.3）。
// ヒーローの判断時点を root とし、サイズを離散化した bet/raise で構築する。
// 金額は「root 以降の追加投入額」で管理し、終端に pot と両者投入額を焼き込む。
// turn 木ではベッティングラウンド終了（call / check-check）が showdown ではなく
// chance node（river カード分岐 × river ベッティングサブツリー）になる。

import type { Card } from '../../cards';

/** 0 = hero, 1 = villain */
export type PlayerIdx = 0 | 1;

export type EdgeAction = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export type ActionEdge = {
  action: EdgeAction;
  /** アクターの追加投入額(bb) */
  add: number;
  child: number;
};

export type DecisionNode = { kind: 'decision'; actor: PlayerIdx; edges: ActionEdge[] };
export type FoldNode = {
  kind: 'fold';
  winner: PlayerIdx;
  /** 終端ポット（root pot + 両者追加投入） */
  pot: number;
  invested: [number, number];
};
export type ShowdownNode = {
  kind: 'showdown';
  pot: number;
  invested: [number, number];
  /** turn 木の chance 分岐下でのみ設定。評価時に EvalView の選択キーになる */
  river?: Card;
};
export type ChanceNode = {
  kind: 'chance';
  children: { river: Card; child: number }[];
  /** 任意の両立コンボペア (h,j) から見た有効 river 枚数 = children.length - 4。値の正規化に使う */
  pairRivers: number;
};

export type TreeNode = DecisionNode | FoldNode | ShowdownNode | ChanceNode;

export type TreeConfig = {
  /** bet サイズ（その時点の pot 比） */
  betSizesPot: number[];
  /** raise サイズ（コール後 pot 比の追加増分） */
  raiseSizesPot: number[];
  /** root 以降に許すレイズ回数（bet は数えない）。turn 木ではストリートごとにリセット */
  maxRaises: number;
};

/** river の raise cap・サイズセット（§10 未決事項1: 実測で調整予定） */
export const DEFAULT_TREE_CONFIG: TreeConfig = {
  betSizesPot: [0.33, 0.75],
  raiseSizesPot: [0.75],
  maxRaises: 1,
};

/** turn 木のサイズセット。木が river の約48倍重いため単一サイズで開始（§10 未決事項1） */
export const TURN_TREE_CONFIG: TreeConfig = {
  betSizesPot: [0.75],
  raiseSizesPot: [0.75],
  maxRaises: 1,
};

export type RootState = {
  /** root 時点の総ポット（hero の今回分を含まない） */
  pot: number;
  /** hero がコールに必要な追加額。0 = check 可 */
  toCall: number;
  /** [hero, villain] の残スタック */
  stacks: [number, number];
  /** villain が現ストリートで既に check 済みか（true なら hero の check でラウンド終了） */
  villainChecked: boolean;
  /** root での hero のレイズ可否（short all-in 非再オープン等。snapshot.legal.canRaise） */
  heroCanRaise: boolean;
  /** root でのレイズ最小増分（bb）。toCall>0 のときのみ意味を持つ */
  minRaiseInc: number;
};

export type TurnRootState = RootState & {
  /** river で先に行動するプレイヤー（OOP 側）。turn 途中の root 手番とは独立に指定する */
  riverFirstActor: PlayerIdx;
};

type BuildState = {
  actor: PlayerIdx;
  pot: number;
  toCall: number;
  stacks: [number, number];
  invested: [number, number];
  raisesUsed: number;
  /** 直前の bet/raise の増分（min raise 判定用） */
  lastInc: number;
  /** check で手番が閉じるか */
  closesOnCheck: boolean;
  canRaise: boolean;
};

type BuildCtx = {
  nodes: TreeNode[];
  config: TreeConfig;
  rootPot: number;
  /** ベッティングラウンド終了（call / check-check）時の子ノードを作る。
   *  river では showdown 終端、turn では chance node になる */
  onRoundClose: (invested: [number, number], stacks: [number, number]) => number;
};

const EPS = 1e-9;

function addNode(ctx: BuildCtx, node: TreeNode): number {
  ctx.nodes.push(node);
  return ctx.nodes.length - 1;
}

function buildStreet(s: BuildState, ctx: BuildCtx): number {
  const me = s.actor;
  const opp = (1 - me) as PlayerIdx;
  const stack = s.stacks[me];
  const { config } = ctx;
  const edges: ActionEdge[] = [];

  const terminalInvested = (addMe: number, refundOpp = 0): [number, number] => {
    const inv: [number, number] = [...s.invested];
    inv[me] += addMe;
    inv[opp] -= refundOpp;
    return inv;
  };

  if (s.toCall > EPS) {
    // fold
    const foldInv = terminalInvested(0);
    edges.push({
      action: 'fold',
      add: 0,
      child: addNode(ctx, {
        kind: 'fold',
        winner: opp,
        pot: ctx.rootPot + foldInv[0] + foldInv[1],
        invested: foldInv,
      }),
    });
    // call（ショートコール時は相手の未コール分を返還）→ ラウンド終了
    const callAdd = Math.min(s.toCall, stack);
    const refund = s.toCall - callAdd;
    const callInv = terminalInvested(callAdd, refund);
    const callStacks = swap(s.stacks, me, -callAdd);
    edges.push({
      action: callAdd === stack ? 'allin' : 'call',
      add: callAdd,
      child: ctx.onRoundClose(callInv, callStacks),
    });
    // raise（cap 内・相手に応答余地がある場合のみ）
    if (s.canRaise && s.raisesUsed < config.maxRaises && stack > s.toCall + EPS && s.stacks[opp] > EPS) {
      const potAfterCall = s.pot + s.toCall;
      const adds = new Set<number>();
      for (const ratio of config.raiseSizesPot) {
        const inc = Math.max(ratio * potAfterCall, s.lastInc);
        const add = s.toCall + inc;
        adds.add(add >= stack - EPS ? stack : add);
      }
      adds.add(stack); // all-in raise は常に含める
      for (const add of [...adds].sort((a, b) => a - b)) {
        const inc = add - s.toCall;
        if (inc <= EPS) continue;
        if (inc < s.lastInc - EPS && add < stack - EPS) continue; // min raise 未満（all-in を除く）
        edges.push({
          action: add === stack ? 'allin' : 'raise',
          add,
          child: buildStreet(
            {
              actor: opp,
              pot: s.pot + add,
              toCall: inc,
              stacks: swap(s.stacks, me, -add),
              invested: swap(s.invested, me, add),
              raisesUsed: s.raisesUsed + 1,
              lastInc: inc,
              closesOnCheck: false,
              canRaise: true,
            },
            ctx,
          ),
        });
      }
    }
  } else {
    // check
    if (s.closesOnCheck) {
      edges.push({
        action: 'check',
        add: 0,
        child: ctx.onRoundClose([...s.invested], [...s.stacks]),
      });
    } else {
      edges.push({
        action: 'check',
        add: 0,
        child: buildStreet({ ...s, actor: opp, closesOnCheck: true }, ctx),
      });
    }
    // bet（相手に応答余地がある場合のみ）
    if (stack > EPS && s.stacks[opp] > EPS) {
      const adds = new Set<number>();
      for (const ratio of config.betSizesPot) {
        const add = ratio * s.pot;
        if (add <= EPS) continue;
        adds.add(add >= stack - EPS ? stack : add);
      }
      adds.add(stack); // all-in bet
      for (const add of [...adds].sort((a, b) => a - b)) {
        edges.push({
          action: add === stack ? 'allin' : 'bet',
          add,
          child: buildStreet(
            {
              actor: opp,
              pot: s.pot + add,
              toCall: add,
              stacks: swap(s.stacks, me, -add),
              invested: swap(s.invested, me, add),
              raisesUsed: s.raisesUsed,
              lastInc: add,
              closesOnCheck: false,
              canRaise: true,
            },
            ctx,
          ),
        });
      }
    }
  }

  return addNode(ctx, { kind: 'decision', actor: me, edges });
}

function rootBuildState(root: RootState): BuildState {
  return {
    actor: 0,
    pot: root.pot,
    toCall: root.toCall,
    stacks: [...root.stacks],
    invested: [0, 0],
    raisesUsed: 0,
    lastInc: root.toCall > EPS ? root.minRaiseInc : 0,
    closesOnCheck: root.villainChecked,
    canRaise: root.heroCanRaise,
  };
}

/** root を index 0 に置き直す（利用側の便宜） */
function moveRootToFront(nodes: TreeNode[], rootIdx: number): void {
  if (rootIdx === 0) return;
  const rootNode = nodes[rootIdx];
  nodes.splice(rootIdx, 1);
  nodes.unshift(rootNode);
  const remap = (i: number): number => (i === rootIdx ? 0 : i < rootIdx ? i + 1 : i);
  for (const n of nodes) {
    if (n.kind === 'decision') for (const e of n.edges) e.child = remap(e.child);
    if (n.kind === 'chance') for (const c of n.children) c.child = remap(c.child);
  }
}

export function buildRiverTree(root: RootState, config: TreeConfig = DEFAULT_TREE_CONFIG): TreeNode[] {
  const nodes: TreeNode[] = [];
  const ctx: BuildCtx = {
    nodes,
    config,
    rootPot: root.pot,
    onRoundClose: (invested) => {
      nodes.push({ kind: 'showdown', pot: root.pot + invested[0] + invested[1], invested });
      return nodes.length - 1;
    },
  };
  const rootIdx = buildStreet(rootBuildState(root), ctx);
  moveRootToFront(nodes, rootIdx);
  return nodes;
}

/** turn 2ストリート木（L2）。rivers は候補 river カード全枚（52 − board 4枚 = 48枚）を渡す。
 *  レンジ側のカードで候補を削らないこと（コンボとの衝突は評価側の reach マスクで処理）。 */
export function buildTurnTree(
  root: TurnRootState,
  rivers: Card[],
  config: TreeConfig = TURN_TREE_CONFIG,
): TreeNode[] {
  const nodes: TreeNode[] = [];

  const showdownAt = (river: Card, invested: [number, number]): number => {
    nodes.push({
      kind: 'showdown',
      pot: root.pot + invested[0] + invested[1],
      invested,
      river,
    });
    return nodes.length - 1;
  };

  const turnCtx: BuildCtx = {
    nodes,
    config,
    rootPot: root.pot,
    onRoundClose: (invested, stacks) => {
      const bothHaveChips = stacks[0] > EPS && stacks[1] > EPS;
      const children = rivers.map((river) => {
        if (!bothHaveChips) {
          return { river, child: showdownAt(river, [...invested]) };
        }
        const riverCtx: BuildCtx = {
          nodes,
          config,
          rootPot: root.pot,
          onRoundClose: (riverInvested) => showdownAt(river, riverInvested),
        };
        const child = buildStreet(
          {
            actor: root.riverFirstActor,
            pot: root.pot + invested[0] + invested[1],
            toCall: 0,
            stacks: [...stacks],
            invested: [...invested],
            raisesUsed: 0,
            lastInc: 0,
            closesOnCheck: false,
            canRaise: true,
          },
          riverCtx,
        );
        return { river, child };
      });
      nodes.push({ kind: 'chance', children, pairRivers: rivers.length - 4 });
      return nodes.length - 1;
    },
  };

  const rootIdx = buildStreet(rootBuildState(root), turnCtx);
  moveRootToFront(nodes, rootIdx);
  return nodes;
}

function swap(arr: [number, number], idx: PlayerIdx, delta: number): [number, number] {
  const next: [number, number] = [...arr];
  next[idx] += delta;
  return next;
}
