import type { PublicGameState } from '../core/online/types';
import type { PlayerActionType } from '../core/game/types';
import { formatAmount, type ChipDisplay } from './chips';

export type SeatActionBadge = { action: PlayerActionType; amount?: number };

const ACTION_BADGE_LABEL: Record<Exclude<PlayerActionType, 'bet' | 'raise'>, string> = {
  fold: 'Fold',
  check: 'Check',
  call: 'Call',
  allin: 'All-in',
};

/** バッジ/ログのアクション表示ラベル({action, amount?}のみ参照。OnlineTableのシートバッジと
 * 履歴タブのアクションログで共用する)。 */
export function actionBadgeLabel(badge: SeatActionBadge, chipDisplay: ChipDisplay): string {
  if (badge.action === 'bet') return `Bet ${formatAmount(badge.amount ?? 0, chipDisplay)}`;
  if (badge.action === 'raise') return `Raise ${formatAmount(badge.amount ?? 0, chipDisplay)}`;
  return ACTION_BADGE_LABEL[badge.action];
}

/** 各playerIdについて、現在表示すべきアクションバッジを返す(該当なしはnull)。
 * ルール: そのプレイヤーが手の途中で一度でもfoldしていれば、ストリートが変わってもハンド終了まで
 * 常に{action:'fold'}を返す。foldしていなければ、publicState.streetと一致する最後のlogエントリを返す
 * (無ければnull)。 */
export function seatActionBadges(publicState: PublicGameState): (SeatActionBadge | null)[] {
  const n = publicState.players.length;
  const folded = new Array<boolean>(n).fill(false);
  for (const entry of publicState.log) {
    if (entry.action === 'fold') folded[entry.playerId] = true;
  }

  const lastOnCurrentStreet = new Map<number, SeatActionBadge>();
  for (const entry of publicState.log) {
    if (entry.street !== publicState.street) continue;
    lastOnCurrentStreet.set(entry.playerId, { action: entry.action, amount: entry.amount });
  }

  return Array.from({ length: n }, (_, i) => {
    if (folded[i]) return { action: 'fold' as const };
    return lastOnCurrentStreet.get(i) ?? null;
  });
}
