import type { Card } from '../../cards';
import { cardsToHandClass } from '../../handNotation';
import type { DecisionSnapshot } from '../../review/snapshot';
import { buildSubgameRanges } from '../ranges';
import {
  buildSpotQuery,
  type ActionCandidate,
  type AnalyzeContext,
  type Confidence,
  type StrategyAdvice,
} from '../types';
import { buildComboSet, cardId, compatibleMass, type ComboSet } from './terminal';
import { buildRiverTree, DEFAULT_TREE_CONFIG, type RootState } from './tree';
import { DEFAULT_CFR_OPTIONS, solveCfr, type CfrInput } from './cfr';
import { rootEdgeValues } from './exploit';
import { EDGE_TO_ACTION, matchTaken } from './advice';

// L1: HU river サブゲーム厳密解（docs/SOLVER-REVIEW-DESIGN.md §5.2）。
// 収束失敗・レンジ仮定の破綻時は null を返し、呼び出し側が legacy にフォールバックする
// （誤った「GTO解」を出さないため）。
// evBB の基準:「いま fold したときを 0 とした期待獲得(bb)」。

/** レンジ仮定にヒーロー実ハンドが含まれない場合に強制付与する重み */
const HERO_FORCED_WEIGHT = 0.05;

const EPS = 1e-9;

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

export function solveRiverSnapshot(snapshot: DecisionSnapshot, ctx: AnalyzeContext): StrategyAdvice | null {
  if (snapshot.street !== 'river' || snapshot.board.length !== 5) return null;
  if (snapshot.context.isMultiway || snapshot.context.villainIds.length !== 1) return null;

  const heroSeat = snapshot.players.find((p) => p.playerId === snapshot.actor.playerId);
  const villainSeat = snapshot.players.find((p) => p.playerId === snapshot.context.villainIds[0]);
  if (!heroSeat || !villainSeat) return null;

  const ranges = buildSubgameRanges(snapshot, ctx);
  if (!ranges) return null;

  // ヒーロー実ハンドがレンジ仮定に無い（チャートが想定しないライン）場合は強制的に含める
  const heroClass = cardsToHandClass(ctx.heroHole[0], ctx.heroHole[1]);
  const heroIds = [cardId(ctx.heroHole[0]), cardId(ctx.heroHole[1])];
  let heroForced = false;
  const hasHeroCombo = ranges.hero.combos.some(({ cards, weight }) => {
    const ids = [cardId(cards[0]), cardId(cards[1])];
    return weight > EPS && ids.includes(heroIds[0]) && ids.includes(heroIds[1]);
  });
  if (!hasHeroCombo) {
    ranges.hero.combos.push({ cards: [ctx.heroHole[0], ctx.heroHole[1]], weight: HERO_FORCED_WEIGHT });
    heroForced = true;
  }

  const heroSet = buildComboSet(ranges.hero.combos, snapshot.board);
  const villainSet = buildComboSet(ranges.villain.combos, snapshot.board);
  const heroIdx = findComboIndex(heroSet, ctx.heroHole);
  // ヒーロー実ハンドがボードと重複している等はデータ破損
  if (heroIdx < 0 || villainSet.n === 0) return null;

  const villainChecked = snapshot.actionHistory.some(
    (e) =>
      e.street === 'river' && e.playerId === villainSeat.playerId && e.action === 'check',
  );
  const root: RootState = {
    pot: snapshot.potBefore,
    toCall: snapshot.toCall,
    stacks: [heroSeat.stack, villainSeat.stack],
    villainChecked,
    heroCanRaise: snapshot.legal.canRaise,
    minRaiseInc: snapshot.legal.canRaise
      ? snapshot.legal.minBetTo - heroSeat.committedStreet - snapshot.toCall
      : 0,
  };
  const nodes = buildRiverTree(root, DEFAULT_TREE_CONFIG);
  const input: CfrInput = { nodes, rootPot: snapshot.potBefore, combos: [heroSet, villainSet] };

  const solution = solveCfr(input, DEFAULT_CFR_OPTIONS);
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
    explanationKeys: ['cfr-river-equilibrium'],
    add: edge.add,
  }));
  candidates.sort((a, b) => b.frequency - a.frequency);

  const takenCandidate = matchTaken(snapshot, candidates);
  const best = candidates.reduce((m, c) => (c.evBB! > m.evBB! ? c : m), candidates[0]);

  let confidence: Confidence = snapshot.reliability === 'approx' ? 'medium' : 'high';
  if (ranges.rare || heroForced) confidence = 'low';

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
        ...ranges.hero.assumption,
        combos: heroSet.n,
        note: heroForced
          ? `${ranges.hero.assumption.note ?? ''}（実ハンドがチャート外のため重み ${HERO_FORCED_WEIGHT} で追加）`
          : ranges.hero.assumption.note,
      },
      villainRange: { ...ranges.villain.assumption, combos: villainSet.n },
      iterations: solution.iterations,
    },
  };
}
