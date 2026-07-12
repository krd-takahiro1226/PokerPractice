import { SUITS, rankValue, cardRank, cardSuit, type Card } from '../../cards';
import { evaluate7 } from '../../evaluator';
import { cardsToHandClass, type HandClass } from '../../handNotation';
import type { ChanceNode, PlayerIdx, ShowdownNode } from './tree';

// 終端評価（docs/SOLVER-REVIEW-DESIGN.md §5.2）。
// showdown 終端の素朴な O(H×V) を避け、両者コンボを強度ソートし prefix sum で O(H+V) にする。
// カードリムーバル（同一カードを共有するペアは無効）はカード別 running sum の補正項で処理する。

export function cardId(c: Card): number {
  return rankValue(cardRank(c)) * 4 + SUITS.indexOf(cardSuit(c));
}

export type WeightedCombo = {
  cards: [Card, Card];
  weight: number;
};

/** 強度昇順にソート済みのコンボ集合。board は river の5枚固定なので strength は前計算。 */
export type ComboSet = {
  n: number;
  cards: [Card, Card][];
  cardA: Uint8Array;
  cardB: Uint8Array;
  /** evaluate7(hole + board)。昇順ソート済み */
  strength: Float64Array;
  /** レンジ重み（reach の初期値） */
  weight: Float64Array;
  classKey: HandClass[];
};

/** レンジ重み付きコンボ → ソート済み ComboSet。board と重なるコンボは除外する。
 *  board が river まで確定（5枚）のときのみ強度を前計算してソートする。
 *  turn（4枚）では強度 0・入力順のまま返し、評価は river 別の EvalView 側で行う。 */
export function buildComboSet(combos: WeightedCombo[], board: Card[]): ComboSet {
  const boardIds = new Set(board.map(cardId));
  const hasRiver = board.length >= 5;
  const rows = combos
    .filter(({ cards, weight }) => weight > 0 && !boardIds.has(cardId(cards[0])) && !boardIds.has(cardId(cards[1])))
    .map(({ cards, weight }) => ({
      cards,
      weight,
      a: cardId(cards[0]),
      b: cardId(cards[1]),
      strength: hasRiver ? evaluate7([cards[0], cards[1], ...board]) : 0,
    }));
  if (hasRiver) rows.sort((x, y) => x.strength - y.strength);

  const n = rows.length;
  const set: ComboSet = {
    n,
    cards: rows.map((r) => r.cards),
    cardA: new Uint8Array(n),
    cardB: new Uint8Array(n),
    strength: new Float64Array(n),
    weight: new Float64Array(n),
    classKey: rows.map((r) => cardsToHandClass(r.cards[0], r.cards[1])),
  };
  for (let i = 0; i < n; i++) {
    set.cardA[i] = rows[i].a;
    set.cardB[i] = rows[i].b;
    set.strength[i] = rows[i].strength;
    set.weight[i] = rows[i].weight;
  }
  return set;
}

const comboKey = (a: number, b: number): number => (a < b ? a * 52 + b : b * 52 + a);

// ── turn(L2) 用: river カード別の評価ビュー ─────────────────────────────────
// ComboSet の並びはある1枚のボードでの強度昇順に固定されるため、turn 木では
// combo index を全ノードで共有し、river ごとの強度順は EvalView（index の間接参照）で持つ。
// river カードと衝突するコンボは order から除外され、評価上自動的にマスクされる。

export type EvalView = {
  /** 強度昇順の combo index（river カードを含むコンボは除外済み） */
  order: Uint32Array;
  /** order と同順の evaluate7 強度 */
  strength: Float64Array;
};

/** board(4枚) + river での強度順ビューを構築する。 */
export function buildEvalView(set: ComboSet, board: Card[], river: Card): EvalView {
  const riverId = cardId(river);
  const rows: { idx: number; s: number }[] = [];
  for (let i = 0; i < set.n; i++) {
    if (set.cardA[i] === riverId || set.cardB[i] === riverId) continue;
    rows.push({ idx: i, s: evaluate7([set.cards[i][0], set.cards[i][1], ...board, river]) });
  }
  rows.sort((a, b) => a.s - b.s);
  const view: EvalView = { order: new Uint32Array(rows.length), strength: new Float64Array(rows.length) };
  for (let k = 0; k < rows.length; k++) {
    view.order[k] = rows[k].idx;
    view.strength[k] = rows[k].s;
  }
  return view;
}

/** ComboSet 自身の並び（river 固定ボードで強度昇順ソート済み）をそのまま使うビュー。 */
export function identityView(set: ComboSet): EvalView {
  const order = new Uint32Array(set.n);
  for (let i = 0; i < set.n; i++) order[i] = i;
  return { order, strength: set.strength };
}

/** river カードを含むコンボの reach を 0 にした複製を返す（chance node の分岐用）。 */
export function maskReachByCard(set: ComboSet, reach: Float64Array, river: Card): Float64Array {
  const riverId = cardId(river);
  const out = new Float64Array(reach);
  for (let i = 0; i < set.n; i++) {
    if (set.cardA[i] === riverId || set.cardB[i] === riverId) out[i] = 0;
  }
  return out;
}

/** showdown 終端評価。river 注釈（turn 木の chance 分岐下）があれば対応する EvalView で評価する。 */
export function showdownNodeValues(
  combos: [ComboSet, ComboSet],
  views: Map<number, [EvalView, EvalView]> | undefined,
  node: ShowdownNode,
  u: PlayerIdx,
  reachOpp: Float64Array,
): Float64Array {
  const own = combos[u];
  const opp = combos[(1 - u) as PlayerIdx];
  if (node.river !== undefined) {
    const pair = views?.get(cardId(node.river));
    if (!pair) throw new Error(`missing eval view for river ${node.river}`);
    return showdownValuesView(own, opp, pair[u], pair[(1 - u) as PlayerIdx], reachOpp, node.pot, node.invested[u]);
  }
  return showdownValues(own, opp, reachOpp, node.pot, node.invested[u]);
}

/** chance node の値の合成: 各 river 分岐で両者 reach をマスクして子を評価し、
 *  river と衝突しない own コンボへ加算して 1/pairRivers で正規化する。
 *  子の走査は traverseChild に委譲（CFR 本体・best response・EV 計算で共用）。 */
export function chanceNodeValues(
  combos: [ComboSet, ComboSet],
  node: ChanceNode,
  u: PlayerIdx,
  reachOwn: Float64Array | null,
  reachOpp: Float64Array,
  traverseChild: (child: number, reachOwn: Float64Array | null, reachOpp: Float64Array) => Float64Array,
): Float64Array {
  const own = combos[u];
  const opp = combos[(1 - u) as PlayerIdx];
  const v = new Float64Array(own.n);
  for (const { river, child } of node.children) {
    const riverId = cardId(river);
    const childReachOwn = reachOwn === null ? null : maskReachByCard(own, reachOwn, river);
    const childReachOpp = maskReachByCard(opp, reachOpp, river);
    const cv = traverseChild(child, childReachOwn, childReachOpp);
    for (let h = 0; h < own.n; h++) {
      if (own.cardA[h] !== riverId && own.cardB[h] !== riverId) v[h] += cv[h];
    }
  }
  const norm = 1 / node.pairRivers;
  for (let h = 0; h < own.n; h++) v[h] *= norm;
  return v;
}

/** 各 own コンボと両立する（カードを共有しない）opp reach の総量。 */
export function compatibleMass(own: ComboSet, opp: ComboSet, oppReach: Float64Array): Float64Array {
  const byCard = new Float64Array(52);
  const exact = new Map<number, number>();
  let total = 0;
  for (let j = 0; j < opp.n; j++) {
    const r = oppReach[j];
    if (r === 0) continue;
    total += r;
    byCard[opp.cardA[j]] += r;
    byCard[opp.cardB[j]] += r;
    const k = comboKey(opp.cardA[j], opp.cardB[j]);
    exact.set(k, (exact.get(k) ?? 0) + r);
  }
  const out = new Float64Array(own.n);
  for (let i = 0; i < own.n; i++) {
    const a = own.cardA[i];
    const b = own.cardB[i];
    out[i] = total - byCard[a] - byCard[b] + (exact.get(comboKey(a, b)) ?? 0);
  }
  return out;
}

/** fold 終端: own が勝者なら gain = pot - ownInvested、敗者なら gain = -ownInvested。
 *  v_h = gain × (両立する opp reach 総量)。 */
export function foldValues(
  own: ComboSet,
  opp: ComboSet,
  oppReach: Float64Array,
  gain: number,
): Float64Array {
  const compat = compatibleMass(own, opp, oppReach);
  const out = new Float64Array(own.n);
  for (let i = 0; i < own.n; i++) out[i] = gain * compat[i];
  return out;
}

/** showdown 終端の counterfactual values（river 固定ボード = ComboSet 自身の並び）。 */
export function showdownValues(
  own: ComboSet,
  opp: ComboSet,
  oppReach: Float64Array,
  pot: number,
  ownInvested: number,
): Float64Array {
  return showdownValuesView(own, opp, identityView(own), identityView(opp), oppReach, pot, ownInvested);
}

/** showdown 終端の counterfactual values（強度順は EvalView で間接参照）:
 *  v_h = pot × (win_h + 0.5 × tie_h) - ownInvested × compat_h
 *  win/tie/compat は own コンボと両立する opp reach の質量。
 *  両者強度昇順を2ポインタで走査し O(H + V + 52)。
 *  view から除外されたコンボ（river と衝突）は out で 0 のまま・opp 側は集計されない。 */
export function showdownValuesView(
  own: ComboSet,
  opp: ComboSet,
  ownView: EvalView,
  oppView: EvalView,
  oppReach: Float64Array,
  pot: number,
  ownInvested: number,
): Float64Array {
  const out = new Float64Array(own.n);
  const oppM = oppView.order.length;

  // below*: strictly weaker / upto*: weaker or equal — の running sums
  const belowByCard = new Float64Array(52);
  const uptoByCard = new Float64Array(52);
  const belowExact = new Map<number, number>();
  const uptoExact = new Map<number, number>();
  let belowTotal = 0;
  let uptoTotal = 0;
  let jBelow = 0;
  let jUpto = 0;

  // 全 opp reach の合計とカード別合計（compat 計算用）
  let allTotal = 0;
  const allByCard = new Float64Array(52);
  const allExact = new Map<number, number>();
  for (let jj = 0; jj < oppM; jj++) {
    const j = oppView.order[jj];
    const r = oppReach[j];
    if (r === 0) continue;
    allTotal += r;
    allByCard[opp.cardA[j]] += r;
    allByCard[opp.cardB[j]] += r;
    const k = comboKey(opp.cardA[j], opp.cardB[j]);
    allExact.set(k, (allExact.get(k) ?? 0) + r);
  }

  const ownM = ownView.order.length;
  for (let ii = 0; ii < ownM; ii++) {
    const i = ownView.order[ii];
    const s = ownView.strength[ii];
    while (jBelow < oppM && oppView.strength[jBelow] < s) {
      const j = oppView.order[jBelow];
      const r = oppReach[j];
      if (r !== 0) {
        belowTotal += r;
        belowByCard[opp.cardA[j]] += r;
        belowByCard[opp.cardB[j]] += r;
        const k = comboKey(opp.cardA[j], opp.cardB[j]);
        belowExact.set(k, (belowExact.get(k) ?? 0) + r);
      }
      jBelow++;
    }
    while (jUpto < oppM && oppView.strength[jUpto] <= s) {
      const j = oppView.order[jUpto];
      const r = oppReach[j];
      if (r !== 0) {
        uptoTotal += r;
        uptoByCard[opp.cardA[j]] += r;
        uptoByCard[opp.cardB[j]] += r;
        const k = comboKey(opp.cardA[j], opp.cardB[j]);
        uptoExact.set(k, (uptoExact.get(k) ?? 0) + r);
      }
      jUpto++;
    }
    const a = own.cardA[i];
    const b = own.cardB[i];
    const kk = comboKey(a, b);
    const win = belowTotal - belowByCard[a] - belowByCard[b] + (belowExact.get(kk) ?? 0);
    const upto = uptoTotal - uptoByCard[a] - uptoByCard[b] + (uptoExact.get(kk) ?? 0);
    const tie = upto - win;
    const compat = allTotal - allByCard[a] - allByCard[b] + (allExact.get(kk) ?? 0);
    out[i] = pot * (win + 0.5 * tie) - ownInvested * compat;
  }
  return out;
}
