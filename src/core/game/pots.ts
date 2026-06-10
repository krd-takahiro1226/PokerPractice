import type { PlayerState } from './types';

export type Pot = { amount: number; eligible: number[] };

/**
 * 各プレイヤーの committedTotal からメイン+サイドポット群を構築する。
 * folded プレイヤーの拠出はポット額に入るが eligible には入らない。
 */
export function buildPots(players: PlayerState[]): Pot[] {
  // 拠出済みのプレイヤーだけ処理（拠出0は無視）
  const contributors = players.filter((p) => p.committedTotal > 0);
  if (contributors.length === 0) return [];

  // committedTotal のコピーを作って層ごとに削り取る
  const remaining = contributors.map((p) => ({
    id: p.id,
    amount: p.committedTotal,
    folded: p.status === 'folded',
  }));

  const pots: Pot[] = [];

  while (remaining.some((r) => r.amount > 0)) {
    // 最小拠出額（>0）を見つける
    const minAmt = Math.min(...remaining.filter((r) => r.amount > 0).map((r) => r.amount));

    let potAmount = 0;
    const eligible: number[] = [];

    for (const r of remaining) {
      if (r.amount <= 0) continue;
      const take = Math.min(r.amount, minAmt);
      potAmount += take;
      r.amount -= take;
      if (!r.folded) eligible.push(r.id);
    }

    if (potAmount > 0) {
      pots.push({ amount: potAmount, eligible });
    }
  }

  return pots;
}

/**
 * 各ポットを eligible の中の最強手（同点は均等分割）に分配する。
 * rankByPlayer: playerId -> evaluate7 の値（高いほど強い）
 */
export function distributePots(
  pots: Pot[],
  rankByPlayer: Map<number, number>,
): Map<number, number> {
  const winnings = new Map<number, number>();

  for (const pot of pots) {
    if (pot.eligible.length === 0) continue;

    // eligible の中で最強のランク値を求める
    let bestRank = -Infinity;
    for (const id of pot.eligible) {
      const rank = rankByPlayer.get(id) ?? -Infinity;
      if (rank > bestRank) bestRank = rank;
    }

    const winners = pot.eligible.filter((id) => (rankByPlayer.get(id) ?? -Infinity) === bestRank);
    const share = pot.amount / winners.length;

    for (const id of winners) {
      winnings.set(id, (winnings.get(id) ?? 0) + share);
    }
  }

  return winnings;
}
