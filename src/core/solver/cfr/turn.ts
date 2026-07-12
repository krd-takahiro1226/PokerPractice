import { makeDeck, removeCards, type Card } from '../../cards';
import { cardsToHandClass } from '../../handNotation';
import type { DecisionSnapshot } from '../../review/snapshot';
import type { Position } from '../../ranges/types';
import { buildSubgameRanges, type SubgameRange } from '../ranges';
import {
  buildSpotQuery,
  type ActionCandidate,
  type AnalyzeContext,
  type Confidence,
  type StrategyAdvice,
} from '../types';
import { buildComboSet, buildEvalView, cardId, compatibleMass, type ComboSet, type EvalView } from './terminal';
import { buildTurnTree, TURN_TREE_CONFIG, type PlayerIdx, type TurnRootState } from './tree';
import { solveCfr, TURN_CFR_OPTIONS, type CfrInput } from './cfr';
import { rootEdgeValues } from './exploit';
import { EDGE_TO_ACTION, matchTaken } from './advice';

// L2: HU turn+river サブゲーム厳密解（docs/SOLVER-REVIEW-DESIGN.md §5.3）。
// river.ts と同じ流れ・ガード・null フォールバック方針。差分は turn 木（chance node で
// river 分岐）を組み立てる点と、コンボ数上限（木が重いため）のみ。

/** レンジ仮定にヒーロー実ハンドが含まれない場合に強制付与する重み */
const HERO_FORCED_WEIGHT = 0.05;

/** turn 木は river の約48倍重いため、片側あたりのコンボ数を上限する */
const COMBO_CAP = 500;

const EPS = 1e-9;

/** ポストフロップの行動順（SB→BTN）。types.ts の同名定数は export されていないため複製。 */
const POSTFLOP_ORDER: Position[] = ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'];

function findComboIndex(set: ComboSet, hole: readonly [Card, Card]): number {
  const a = cardId(hole[0]);
  const b = cardId(hole[1]);
  for (let i = 0; i < set.n; i++) {
    if ((set.cardA[i] === a && set.cardB[i] === b) || (set.cardA[i] === b && set.cardB[i] === a)) {
      return i;
    }
  }
  return -1;
}

/** weight 降順で上位 COMBO_CAP 件に切り、超過時は assumption.note に注記を追記する。 */
function capCombos(range: SubgameRange): SubgameRange {
  if (range.combos.length <= COMBO_CAP) return range;
  const capped = [...range.combos].sort((a, b) => b.weight - a.weight).slice(0, COMBO_CAP);
  const capNote = '計算量制限のため上位500コンボに制限';
  const note = range.assumption.note ? `${range.assumption.note}／${capNote}` : capNote;
  return { combos: capped, assumption: { ...range.assumption, note } };
}

export function solveTurnSnapshot(
  snapshot: DecisionSnapshot,
  ctx: AnalyzeContext,
  onIteration?: (iteration: number, maxIterations: number) => void,
): StrategyAdvice | null {
  if (snapshot.street !== 'turn' || snapshot.board.length !== 4) return null;
  if (snapshot.context.isMultiway || snapshot.context.villainIds.length !== 1) return null;

  const heroSeat = snapshot.players.find((p) => p.playerId === snapshot.actor.playerId);
  const villainSeat = snapshot.players.find((p) => p.playerId === snapshot.context.villainIds[0]);
  if (!heroSeat || !villainSeat) return null;

  const rawRanges = buildSubgameRanges(snapshot, ctx);
  if (!rawRanges) return null;

  const heroRange = capCombos(rawRanges.hero);
  const villainRange = capCombos(rawRanges.villain);

  // ヒーロー実ハンドがレンジ仮定に無い（チャートが想定しないライン）場合は強制的に含める。
  // キャップ後に追加するため、上位500件の切り詰めで実ハンドが落とされることはない。
  const heroClass = cardsToHandClass(ctx.heroHole[0], ctx.heroHole[1]);
  const heroIds = [cardId(ctx.heroHole[0]), cardId(ctx.heroHole[1])];
  let heroForced = false;
  const hasHeroCombo = heroRange.combos.some(({ cards, weight }) => {
    const ids = [cardId(cards[0]), cardId(cards[1])];
    return weight > EPS && ids.includes(heroIds[0]) && ids.includes(heroIds[1]);
  });
  if (!hasHeroCombo) {
    heroRange.combos.push({ cards: [ctx.heroHole[0], ctx.heroHole[1]], weight: HERO_FORCED_WEIGHT });
    heroForced = true;
  }

  const heroSet = buildComboSet(heroRange.combos, snapshot.board);
  const villainSet = buildComboSet(villainRange.combos, snapshot.board);
  const heroIdx = findComboIndex(heroSet, ctx.heroHole);
  // ヒーロー実ハンドがボードと重複している等はデータ破損
  if (heroIdx < 0 || villainSet.n === 0) return null;

  const villainChecked = snapshot.actionHistory.some(
    (e) => e.street === 'turn' && e.playerId === villainSeat.playerId && e.action === 'check',
  );

  const heroPosIdx = POSTFLOP_ORDER.indexOf(heroSeat.pos);
  const villainPosIdx = POSTFLOP_ORDER.indexOf(villainSeat.pos);
  const riverFirstActor: PlayerIdx = heroPosIdx < villainPosIdx ? 0 : 1;

  const root: TurnRootState = {
    pot: snapshot.potBefore,
    toCall: snapshot.toCall,
    stacks: [heroSeat.stack, villainSeat.stack],
    villainChecked,
    heroCanRaise: snapshot.legal.canRaise,
    minRaiseInc: snapshot.legal.canRaise
      ? snapshot.legal.minBetTo - heroSeat.committedStreet - snapshot.toCall
      : 0,
    riverFirstActor,
  };

  // river 候補: レンジ側のカードで削らない（衝突は評価側の reach マスクで自動処理される）
  const rivers = removeCards(makeDeck(), snapshot.board);

  const views = new Map<number, [EvalView, EvalView]>();
  for (const river of rivers) {
    views.set(cardId(river), [
      buildEvalView(heroSet, snapshot.board, river),
      buildEvalView(villainSet, snapshot.board, river),
    ]);
  }

  const nodes = buildTurnTree(root, rivers, TURN_TREE_CONFIG);
  const input: CfrInput = { nodes, rootPot: snapshot.potBefore, combos: [heroSet, villainSet], views };

  const solution = solveCfr(input, { ...TURN_CFR_OPTIONS, onIteration });
  if (!solution.converged) return null;

  // ヒーロー実コンボと両立する villain reach 質量（EV の条件付き正規化に使う）
  const compat = compatibleMass(heroSet, villainSet, villainSet.weight)[heroIdx];
  if (compat <= EPS) return null;

  const rootNode = nodes[0];
  if (rootNode.kind !== 'decision') return null;
  const rootStrategy = solution.avgStrategy.get(0)!;
  const edgeValues = rootEdgeValues(input, solution.avgStrategy);

  const candidates: (ActionCandidate & { add: number })[] = rootNode.edges.map((edge, e) => ({
    action: EDGE_TO_ACTION[edge.action],
    sizeTo: edge.add > EPS ? heroSeat.committedStreet + edge.add : undefined,
    sizePotRatio: edge.add > EPS ? edge.add / snapshot.potBefore : undefined,
    frequency: rootStrategy[e][heroIdx],
    evBB: edgeValues[e][heroIdx] / compat,
    explanationKeys: ['cfr-turn-equilibrium'],
    add: edge.add,
  }));
  candidates.sort((a, b) => b.frequency - a.frequency);

  const takenCandidate = matchTaken(snapshot, candidates);
  const best = candidates.reduce((m, c) => (c.evBB! > m.evBB! ? c : m), candidates[0]);

  let confidence: Confidence = snapshot.reliability === 'approx' ? 'medium' : 'high';
  if (rawRanges.rare || heroForced) confidence = 'low';

  const strip = ({ add: _add, ...c }: ActionCandidate & { add: number }): ActionCandidate => c;
  return {
    spot: buildSpotQuery(snapshot, heroClass),
    candidates: candidates.map(strip),
    takenCandidate: takenCandidate ? strip(takenCandidate) : null,
    evLossBB: takenCandidate ? Math.max(0, best.evBB! - takenCandidate.evBB!) : undefined,
    confidence,
    source: 'cfr-exact',
    solution: {
      exploitabilityPctPot: solution.exploitabilityPctPot,
      heroRange: {
        ...heroRange.assumption,
        combos: heroSet.n,
        note: heroForced
          ? `${heroRange.assumption.note ?? ''}（実ハンドがチャート外のため重み ${HERO_FORCED_WEIGHT} で追加）`
          : heroRange.assumption.note,
      },
      villainRange: { ...villainRange.assumption, combos: villainSet.n },
      iterations: solution.iterations,
    },
  };
}
