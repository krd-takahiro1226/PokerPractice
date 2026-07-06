import { classifyStrength } from './handStrength';
import { estimateEquityVsRanges } from './estimateEquity';
import { estimatePlayerRange } from './villainRange';
import { potOdds } from '../potOdds';
import type { GameState, PlayerAction } from '../game/types';
import type { LegalActions } from '../game/engine';
import type { Card } from '../cards';

/** ポストフロップのアクション決定。 */
export function decidePostflopAction(
  state: GameState,
  playerId: number,
  legal: LegalActions,
  rng: () => number,
): PlayerAction {
  const player = state.players[playerId];
  if (!player.hole) return safeDefault(legal);

  const { made, draw, score } = classifyStrength(player.hole, state.board);
  const difficulty = state.config.difficulty;

  const pot = currentTotalPot(state);
  const toCall = legal.callAmount;
  const odds = toCall > 0 ? potOdds(pot, toCall) : 0;

  if (difficulty === 'easy') {
    return decideEasy(legal, made, draw, score, pot, odds, rng);
  }

  if (difficulty === 'normal') {
    return decideNormal(legal, made, draw, score, pot, odds, rng);
  }

  // hard: estimateEquity を使う
  return decideHard(state, playerId, legal, score, pot, odds, rng);
}

function decideEasy(
  legal: LegalActions,
  made: string,
  draw: string,
  score: number,
  pot: number,
  odds: number,
  rng: () => number,
): PlayerAction {
  // ルース・パッシブ: ペア以上で時々小ベット/コール
  if (legal.canCheck) {
    if (score > 0.5 && rng() < 0.3) {
      // 小ベット
      const betSize = pot * 0.4;
      if (legal.canBet) return { type: 'bet', amount: clamp(betSize, legal.minBetTo, legal.maxBetTo) };
    }
    return { type: 'check' };
  }

  // 直面しているベットに対して
  if (score > 0.5 || draw !== 'none') {
    if (legal.canCall) return { type: 'call' };
  }
  if (score > 0.3 && rng() < 0.3 && legal.canCall) return { type: 'call' };
  return { type: 'fold' };
}

function decideNormal(
  legal: LegalActions,
  made: string,
  draw: string,
  score: number,
  pot: number,
  odds: number,
  rng: () => number,
): PlayerAction {
  // ABC: 強い役はバリューベット、ドローはポットオッズ次第でコール
  if (legal.canCheck) {
    // バリューベット条件
    if (score >= 0.5) {
      const betSize = pot * 0.6;
      if (legal.canBet && rng() < 0.7) {
        return { type: 'bet', amount: clamp(betSize, legal.minBetTo, legal.maxBetTo) };
      }
      if (legal.canRaise && rng() < 0.5) {
        const raiseSize = pot * 0.7;
        return { type: 'raise', amount: clamp(raiseSize, legal.minBetTo, legal.maxBetTo) };
      }
    }
    // セミブラフ
    if ((draw === 'oesd' || draw === 'flush-draw' || draw === 'combo-draw') && rng() < 0.3) {
      const betSize = pot * 0.5;
      if (legal.canBet) return { type: 'bet', amount: clamp(betSize, legal.minBetTo, legal.maxBetTo) };
    }
    return { type: 'check' };
  }

  // コール/フォールド判断
  if (score >= 0.5) {
    if (legal.canCall) return { type: 'call' };
  }
  // ドローでポットオッズが合う
  if (draw !== 'none') {
    const drawEquity = drawEquityApprox(draw);
    if (drawEquity >= odds && legal.canCall) return { type: 'call' };
  }
  // 弱い手でも時々コール（ライトコール）
  if (score > 0.25 && rng() < 0.15 && legal.canCall) return { type: 'call' };
  return { type: 'fold' };
}

function decideHard(
  state: GameState,
  playerId: number,
  legal: LegalActions,
  baseScore: number,
  pot: number,
  odds: number,
  rng: () => number,
): PlayerAction {
  const player = state.players[playerId];
  if (!player.hole) return safeDefault(legal);

  // 生存相手全員のプリフロップログからの推定レンジでマルチウェイエクイティを算出
  const villainRanges = state.players
    .filter((p) => p.id !== playerId && p.status !== 'folded')
    .map((opp) => estimatePlayerRange(state.log, opp.id, state.config.mode));

  // 低反復MCでエクイティを算出
  const equity = estimateEquityVsRanges(
    player.hole,
    state.board,
    villainRanges,
    500, // 軽量化のため500
    rng,
  );

  if (legal.canCheck) {
    // バリューベット: equity高
    if (equity > 0.65) {
      const betSize = pot * 0.65;
      if (legal.canBet && rng() < 0.85) {
        return { type: 'bet', amount: clamp(betSize, legal.minBetTo, legal.maxBetTo) };
      }
      if (legal.canRaise && rng() < 0.7) {
        return { type: 'raise', amount: clamp(pot * 0.75, legal.minBetTo, legal.maxBetTo) };
      }
    }
    // セミブラフ or バランスブラフ
    if (equity > 0.35 && equity <= 0.65 && rng() < 0.35) {
      const betSize = pot * 0.55;
      if (legal.canBet) return { type: 'bet', amount: clamp(betSize, legal.minBetTo, legal.maxBetTo) };
    }
    // ブラフ（バランス）
    if (equity <= 0.35 && rng() < 0.28) {
      const betSize = pot * 0.6;
      if (legal.canBet) return { type: 'bet', amount: clamp(betSize, legal.minBetTo, legal.maxBetTo) };
    }
    return { type: 'check' };
  }

  // コール/フォールド判断（ポットオッズ vs エクイティ）
  if (equity >= odds) {
    if (legal.canCall) return { type: 'call' };
  }
  // MDF ベースのブラフキャッチ（inline: pot/(pot+bet)）
  const mdf = pot / (pot + legal.callAmount);
  if (equity >= mdf * 0.7 && legal.canCall && rng() < 0.4) return { type: 'call' };
  return { type: 'fold' };
}

function drawEquityApprox(draw: string): number {
  switch (draw) {
    case 'combo-draw': return 0.45;
    case 'flush-draw': return 0.35;
    case 'oesd': return 0.32;
    case 'gutshot': return 0.17;
    default: return 0;
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function safeDefault(legal: LegalActions): PlayerAction {
  if (legal.canCheck) return { type: 'check' };
  if (legal.canCall) return { type: 'call' };
  return { type: 'fold' };
}

function currentTotalPot(state: GameState): number {
  return state.pot + state.players.reduce((s, p) => s + p.committedStreet, 0);
}
