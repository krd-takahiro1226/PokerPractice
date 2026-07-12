import type { PlayerActionType } from '../../game/types';
import type { DecisionSnapshot } from '../../review/snapshot';
import type { ActionCandidate } from '../types';
import type { ActionEdge } from './tree';

// river.ts / turn.ts 共通のアドバイス組み立てヘルパー（docs/SOLVER-REVIEW-DESIGN.md §5.2, §5.3）。

const EPS = 1e-9;

export const EDGE_TO_ACTION: Record<ActionEdge['action'], PlayerActionType> = {
  fold: 'fold',
  check: 'check',
  call: 'call',
  bet: 'bet',
  raise: 'raise',
  allin: 'allin',
};

/** 実アクションの最近傍マッチ。コール系は additional がコール額以下、
 *  アグレッシブ系は追加投入額の最近傍で対応付ける。 */
export function matchTaken(
  snapshot: DecisionSnapshot,
  candidates: (ActionCandidate & { add: number })[],
): (ActionCandidate & { add: number }) | null {
  const taken = snapshot.taken;
  if (taken.action === 'fold' || taken.action === 'check') {
    return candidates.find((c) => c.action === taken.action) ?? null;
  }

  const additional = taken.additional ?? 0;
  const heroStack = snapshot.players.find((p) => p.playerId === snapshot.actor.playerId)?.stack ?? 0;
  const callAdd = Math.min(snapshot.toCall, heroStack);

  const isCallLike = snapshot.toCall > EPS && additional <= callAdd + EPS;
  if (taken.action === 'call' || (taken.action === 'allin' && isCallLike)) {
    return (
      candidates.find((c) => c.action === 'call') ??
      candidates.find((c) => c.action === 'allin' && c.add <= snapshot.toCall + EPS) ??
      null
    );
  }

  // bet / raise / allin レイズ: コールを超える追加投入エッジの中から最近傍
  const aggressive = candidates.filter(
    (c) => c.add > (snapshot.toCall > EPS ? snapshot.toCall + EPS : EPS),
  );
  if (aggressive.length === 0) return null;
  return aggressive.reduce((m, c) =>
    Math.abs(c.add - additional) < Math.abs(m.add - additional) ? c : m,
  );
}
