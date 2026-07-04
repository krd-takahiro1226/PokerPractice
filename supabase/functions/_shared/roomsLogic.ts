// rooms.ts の権威ロジックのうち、DB I/O を伴わない純粋な部分を切り出したモジュール。
// Vitest から直接ユニットテストできるようにするための分離（ON-10）。
import { applyAction, legalActions } from './core/game/engine.ts';
import type { LegalActions } from './core/game/engine.ts';
import type { GameState, HandLogEntry, PlayerActionType } from './core/game/types.ts';

/**
 * bet/raise の amount が legal(minBetTo〜maxBetTo)の範囲内か検証する(ON-1)。
 * 非有限値(NaN/Infinity)・範囲外は false。call/check/fold/allin は amount を見ないので常に true。
 */
export function isValidBetAmount(
  move: { type: PlayerActionType; amount?: number },
  legal: LegalActions,
): boolean {
  if (move.type !== 'bet' && move.type !== 'raise') return true;
  const amount = move.amount;
  return (
    typeof amount === 'number' &&
    Number.isFinite(amount) &&
    amount >= legal.minBetTo &&
    amount <= legal.maxBetTo
  );
}

/**
 * engine.ts の applyAction fold ケースを、手番でないプレイヤーにも適用できるよう複製したもの。
 * engine.applyAction は `state.toAct !== playerId` を例外にするため手番外では使えない
 * （leave_room はハンド中いつでも呼べるため、手番外の active プレイヤーを強制foldする必要がある, ON-2）。
 * active でなければ何もしない(既に folded/allin ならそのまま返す)。
 */
export function forceFoldOutOfTurn(state: GameState, seatIndex: number): GameState {
  const player = state.players[seatIndex];
  if (!player || player.status !== 'active') return state;

  const players = state.players.map((p, i) =>
    i === seatIndex ? { ...p, status: 'folded' as const, hasActedThisStreet: true } : p,
  );
  const activeCount = players.filter((p) => p.status === 'active').length;
  // engine.ts の fold ケースと同じ規則: active が1人以下になったら toAct=null にして
  // progressToActionable(→advanceStreet) に解決を委ねる。それ以外は手番はまだ他プレイヤーにあるため
  // toAct は変えない(手番外プレイヤーの離脱は現在のtoActの正当性に影響しない)。
  const toAct = activeCount <= 1 ? null : state.toAct;

  const logEntry: HandLogEntry = {
    street: state.street,
    playerId: seatIndex,
    pos: player.pos,
    action: 'fold',
    amount: undefined,
    potAfter: state.pot + players.reduce((s, p) => s + p.committedStreet, 0),
  };

  return { ...state, players, toAct, log: [...state.log, logEntry] };
}

export type LeaveDuringHandResult = {
  hand: GameState | null;
  /**
   * true = 離脱者は現ハンドで allin 中、結果がまだ確定していない。
   * この場合 hand は変更しない(勝敗未確定のため)。呼び出し側は tournament.ts の markLeft ではなく
   * markLeavingDuringHand を使い、ハンド確定(applyHandResult)まで順位/stack の確定を保留すること。
   */
  pendingLeave: boolean;
};

/**
 * ハンド中の leave_room 処理(ON-2)。手番かどうかに関わらず、現ハンドで active なプレイヤーは
 * 強制的に fold させる(fold なら結果への影響がなく、安全に markLeft できる)。
 * allin 中の離脱はハンド結果が未確定なため hand を変更せず pendingLeave=true を返す。
 * すでに folded、座席が現ハンドの参加者でない(seatIndex===-1)、またはハンドが無い(between-hands)
 * 場合は hand をそのまま返す。
 */
export function resolveLeaveDuringHand(
  hand: GameState | null,
  seatUids: string[],
  uid: string,
): LeaveDuringHandResult {
  if (!hand) return { hand, pendingLeave: false };

  const seatIndex = seatUids.indexOf(uid);
  if (seatIndex === -1) return { hand, pendingLeave: false };

  const player = hand.players[seatIndex];
  if (player.status === 'allin') return { hand, pendingLeave: true };
  if (player.status !== 'active') return { hand, pendingLeave: false };

  if (hand.toAct === seatIndex) {
    // 手番中の離脱: claim_timeout と同じ「これ以上先に進めない」を解消するロジックを流用。
    const legal = legalActions(hand, seatIndex);
    const nextHand = applyAction(hand, seatIndex, legal.canCheck ? { type: 'check' } : { type: 'fold' });
    return { hand: nextHand, pendingLeave: false };
  }

  return { hand: forceFoldOutOfTurn(hand, seatIndex), pendingLeave: false };
}
