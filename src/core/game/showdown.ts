import { evaluate7, handCategory, CATEGORY_NAME } from '../evaluator';
import type { Card } from '../cards';
import type { PlayerState } from './types';
import { buildPots, distributePots } from './pots';

export type ShowdownResult = {
  winners: { playerId: number; amount: number }[];
  shown: { playerId: number; hole: [Card, Card]; handName: string }[];
};

/**
 * ショーダウンに到達したプレイヤーの手を評価し、ポットを分配する。
 * pot: 確定済みポット合計（前ストリートまでの分）
 * players: 現在の全プレイヤー状態（committedTotal 含む）
 */
export function evaluateShowdown(
  players: PlayerState[],
  board: Card[],
): ShowdownResult {
  const rankByPlayer = new Map<number, number>();
  const shown: ShowdownResult['shown'] = [];

  for (const p of players) {
    if (p.status === 'folded' || !p.hole) continue;
    const rank = evaluate7([...p.hole, ...board]);
    rankByPlayer.set(p.id, rank);
    shown.push({
      playerId: p.id,
      hole: p.hole,
      handName: CATEGORY_NAME[handCategory(rank)] ?? 'Unknown',
    });
  }

  const pots = buildPots(players);
  const winnings = distributePots(pots, rankByPlayer);

  const winners = Array.from(winnings.entries()).map(([playerId, amount]) => ({
    playerId,
    amount,
  }));

  return { winners, shown };
}
