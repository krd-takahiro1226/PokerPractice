// Deno Edge Function 側の進行ドライバ。AI 無し・全員人間のためオートプレイは行わず、
// 「これ以上サーバー側だけでは進められない地点」まで機械的に進めるだけ。
import { advanceStreet } from './core/game/engine.ts';
import type { GameState } from './core/game/types.ts';

/**
 * applyAction 済みの state を、toAct が現れるか hand が終わる（showdown 到達）まで自動で進める。
 * ラウンド完了(toAct===null)のたびに advanceStreet を呼ぶだけで、ボード配布・オールインランナウト・
 * ショーダウン解決は全て advanceStreet/resolveShowdown 側の責務（engine.ts 既存ロジックを流用）。
 */
export function progressToActionable(state: GameState): GameState {
  let s = state;
  while (s.toAct === null && !(s.street === 'showdown' && s.result !== null)) {
    s = advanceStreet(s);
  }
  return s;
}
