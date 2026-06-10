import { cardsToHandClass } from '../handNotation';
import { RFI_SCENARIOS } from '../ranges/rfi';
import { getVsOpen } from '../ranges/vsOpen';
import { primaryAction } from '../ranges/types';
import type { GameState, PlayerAction } from '../game/types';
import type { LegalActions } from '../game/engine';

/** プリフロップのアクション決定。 */
export function decidePreflopAction(
  state: GameState,
  playerId: number,
  legal: LegalActions,
  rng: () => number,
): PlayerAction {
  const player = state.players[playerId];
  if (!player.hole) return safeDefault(legal, state);

  const handClass = cardsToHandClass(player.hole[0], player.hole[1]);
  const difficulty = state.config.difficulty;

  // 誰かがすでにオープンしているか判定
  const hasOpener = state.players.some(
    (p) => p.id !== playerId && p.committedStreet > state.config.bb,
  );

  // リンプがいる（BB以外でcommittedStreet=BBの人がいる）かどうか
  const hasLimp = state.players.some(
    (p) =>
      p.id !== playerId &&
      p.pos !== 'BB' &&
      p.committedStreet === state.config.bb &&
      p.status === 'active',
  );

  // BB で round が回ってきた（誰もレイズしていない）
  if (player.pos === 'BB' && !hasOpener) {
    if (legal.canCheck) return { type: 'check' };
    // limpers がいる場合: BBはチェックかレイズ
    if (difficulty === 'easy') return { type: 'check' };
    return { type: 'check' };
  }

  // RFI（Raise First In）: 誰もベット/レイズしていない
  if (!hasOpener && !hasLimp) {
    return decidePreflopRFI(state, playerId, legal, handClass, difficulty, rng);
  }

  // vs open: 誰かがすでにレイズしている
  if (hasOpener) {
    return decidePreflopVsOpen(state, playerId, legal, handClass, difficulty, rng);
  }

  // limp がいるがraiseはない（flat limp or isolation raise）
  return decidePreflopVsLimp(state, playerId, legal, handClass, difficulty, rng);
}

function decidePreflopRFI(
  state: GameState,
  playerId: number,
  legal: LegalActions,
  handClass: string,
  difficulty: GameConfig['difficulty'],
  rng: () => number,
): PlayerAction {
  const player = state.players[playerId];
  const pos = player.pos;
  const scenario = RFI_SCENARIOS.find((s) => s.heroPos === pos);

  if (!scenario) {
    // BTNはレンジなし（いないはずだが安全策）
    return { type: 'fold' };
  }

  const action = scenario.range[handClass];
  const raiseFreq = action?.raise ?? 0;

  if (difficulty === 'easy') {
    // やさしい: 広くコール、プレミアムのみレイズ
    const isPremium = isPremiumHand(handClass);
    const isPlayable = isLoosePlayableHand(handClass);
    if (isPremium && legal.canRaise && rng() < 0.7) {
      const openSize = pos === 'SB' ? 3 : 2.5;
      return { type: 'raise', amount: clamp(openSize, legal.minBetTo, legal.maxBetTo) };
    }
    if (isPlayable && legal.canCall) return { type: 'call' };
    if (rng() < 0.3 && legal.canCall) return { type: 'call' }; // ルースコール
    return { type: 'fold' };
  }

  if (difficulty === 'normal' || difficulty === 'hard') {
    // ふつう/つよい: RFIレンジに従う
    if (raiseFreq > 0 && rng() < raiseFreq) {
      if (!legal.canRaise && !legal.canBet) return { type: 'call' };
      const openSize = pos === 'SB' ? 3 : 2.5;
      if (legal.canRaise) {
        return { type: 'raise', amount: clamp(openSize, legal.minBetTo, legal.maxBetTo) };
      }
      return { type: 'bet', amount: clamp(openSize, legal.minBetTo, legal.maxBetTo) };
    }
    return { type: 'fold' };
  }

  return { type: 'fold' };
}

function decidePreflopVsOpen(
  state: GameState,
  playerId: number,
  legal: LegalActions,
  handClass: string,
  difficulty: GameConfig['difficulty'],
  rng: () => number,
): PlayerAction {
  const player = state.players[playerId];
  const pos = player.pos;

  // openerを見つける
  const opener = state.players.find(
    (p) => p.status === 'active' && p.committedStreet > state.config.bb && p.id !== playerId,
  ) ?? state.players.find((p) => p.committedStreet > state.config.bb);
  const openerPos = opener?.pos;

  if (difficulty === 'easy') {
    // やさしい: プレミアムはコール、ゴミは多くfold
    const score = handClassScore(handClass);
    if (score > 0.6 && legal.canCall) return { type: 'call' };
    if (score > 0.45 && legal.canCall && rng() < 0.6) return { type: 'call' };
    if (score > 0.3 && legal.canCall && rng() < 0.25) return { type: 'call' };
    return { type: 'fold' };
  }

  // ふつう/つよい: vsOpenレンジ参照
  const scenario = openerPos ? getVsOpen(pos, openerPos) : undefined;

  if (scenario) {
    const action = scenario.range[handClass];
    const pa = primaryAction(action);
    if (pa === 'raise') {
      const freq = action?.raise ?? 0;
      if (rng() < freq) {
        const threebet = state.currentBet * 3;
        if (legal.canRaise) {
          return { type: 'raise', amount: clamp(threebet, legal.minBetTo, legal.maxBetTo) };
        }
      }
      // raiseできなければ call にフォールバック
      if (legal.canCall) return { type: 'call' };
    }
    if (pa === 'call') {
      const freq = action?.call ?? 0;
      if (rng() < freq && legal.canCall) return { type: 'call' };
    }
    return { type: 'fold' };
  }

  // データなし: タイトなデフォルト
  const score = handClassScore(handClass);
  if (score > 0.65 && legal.canCall) return { type: 'call' };
  if (score > 0.8 && legal.canRaise && rng() < 0.5) {
    const threebet = state.currentBet * 3;
    return { type: 'raise', amount: clamp(threebet, legal.minBetTo, legal.maxBetTo) };
  }
  return { type: 'fold' };
}

function decidePreflopVsLimp(
  state: GameState,
  playerId: number,
  legal: LegalActions,
  handClass: string,
  difficulty: GameConfig['difficulty'],
  rng: () => number,
): PlayerAction {
  // limp が入っている場合: 強い手はisolation raise、中程度はオーバーコール/フォールド
  const score = handClassScore(handClass);

  if (difficulty === 'easy') {
    if (score > 0.5 && legal.canCall) return { type: 'call' };
    if (score > 0.3 && rng() < 0.4 && legal.canCall) return { type: 'call' };
    return { type: 'fold' };
  }

  if (score > 0.7 && legal.canRaise && rng() < 0.8) {
    const isoSize = state.config.bb * 4;
    return { type: 'raise', amount: clamp(isoSize, legal.minBetTo, legal.maxBetTo) };
  }
  if (score > 0.5 && legal.canCall && rng() < 0.5) return { type: 'call' };
  return { type: 'fold' };
}

// ハンドクラスの強さスコア（簡易）
function handClassScore(hc: string): number {
  const pairs: Record<string, number> = {
    AA: 1.0, KK: 0.97, QQ: 0.94, JJ: 0.88, TT: 0.82, '99': 0.75, '88': 0.68,
    '77': 0.62, '66': 0.56, '55': 0.50, '44': 0.45, '33': 0.40, '22': 0.36,
  };
  if (pairs[hc]) return pairs[hc];

  const hi = hc[0];
  const lo = hc[1];
  const suffix = hc[2];
  const hiVal = rankValue(hi);
  const loVal = rankValue(lo);
  const suitedBonus = suffix === 's' ? 0.05 : 0;
  const gap = hiVal - loVal;
  const gapPenalty = Math.max(0, (gap - 1) * 0.03);
  const base = (hiVal / 12) * 0.45 + (loVal / 12) * 0.25;
  return Math.min(0.95, base + suitedBonus - gapPenalty);
}

// ランク値（文字）取得ヘルパ
function rankValue(r: string): number {
  const ranks = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
  return ranks.indexOf(r);
}

function isPremiumHand(hc: string): boolean {
  return ['AA','KK','QQ','JJ','AKs','AKo','TT'].includes(hc);
}

function isLoosePlayableHand(hc: string): boolean {
  if (hc.length === 2) return true; // 全ペア
  const hiVal = rankValue(hc[0]);
  const loVal = rankValue(hc[1]);
  const suited = hc[2] === 's';
  if (hiVal >= 8) return true; // Tx以上
  if (suited && hiVal >= 5) return true; // スーテッドT以上
  if (loVal >= 5 && hiVal - loVal <= 2) return true; // コネクタ
  return false;
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function safeDefault(legal: LegalActions, state: GameState): PlayerAction {
  if (legal.canCheck) return { type: 'check' };
  if (legal.canCall) return { type: 'call' };
  return { type: 'fold' };
}

// 型参照のためのインポート
type GameConfig = { difficulty: 'easy' | 'normal' | 'hard' };
