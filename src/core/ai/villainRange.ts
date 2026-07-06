// '../ranges'(ディレクトリ import)は sync:functions の .ts 付与で '../ranges.ts' になり
// Deno で解決できないため、index を明示する
import { getScenarioForMode } from '../ranges/index';
import { getVsOpen } from '../ranges/vsOpen';
import type { GameMode } from '../ranges/mode';
import type { Range } from '../ranges/types';
import type { HandLogEntry } from '../game/types';

/**
 * プリフロップのログのみから対象プレイヤーの推定レンジを構築する。
 * オープナー本人なら RFI レンジ、3bettor/コーラーなら vsOpen レンジを採用し、
 * 情報が無い/レンジが空になる場合は広域レンジにフォールバックする。
 */
export function estimatePlayerRange(
  log: HandLogEntry[],
  playerId: number,
  mode: GameMode,
): Record<string, number> {
  const preflopEntries = log.filter((e) => e.street === 'preflop');
  const openIndex = preflopEntries.findIndex((e) => e.action === 'raise' || e.action === 'bet');

  if (openIndex === -1) {
    // リンプ/BBチェックのみ等、プリフロップに自発的なオープンが無い
    return buildBroadRange();
  }

  const openEntry = preflopEntries[openIndex];

  if (openEntry.playerId === playerId) {
    const raiseRange = rangeFromScenario(getScenarioForMode(`RFI_${openEntry.pos}`, mode), 'raise');
    return hasEntries(raiseRange) ? raiseRange : buildBroadRange();
  }

  // オープンより後の、対象プレイヤーの最初の raise/call を探す
  const response = preflopEntries
    .slice(openIndex + 1)
    .find((e) => e.playerId === playerId && (e.action === 'raise' || e.action === 'call'));

  if (response) {
    if (response.action === 'raise') {
      const raiseRange = rangeFromScenario(getVsOpen(response.pos, openEntry.pos), 'raise');
      if (hasEntries(raiseRange)) return raiseRange;
      // vsOpen が取れない場合は本人ポジションの RFI レンジで代用
      const rfiFallback = rangeFromScenario(getScenarioForMode(`RFI_${response.pos}`, mode), 'raise');
      if (hasEntries(rfiFallback)) return rfiFallback;
    } else {
      const callRange = rangeFromScenario(getVsOpen(response.pos, openEntry.pos), 'call');
      if (hasEntries(callRange)) return callRange;
    }
  }

  return buildBroadRange();
}

function rangeFromScenario(
  scenario: { range: Range } | undefined,
  key: 'raise' | 'call',
): Record<string, number> {
  if (!scenario) return {};
  const range: Record<string, number> = {};
  for (const [hc, action] of Object.entries(scenario.range)) {
    const freq = action[key] ?? 0;
    if (freq > 0) range[hc] = freq;
  }
  return range;
}

function hasEntries(range: Record<string, number>): boolean {
  return Object.keys(range).length > 0;
}

/** 広域レンジ（保守的: 上位約40%のハンド）。情報不足時のフォールバックとして使う。 */
export function buildBroadRange(): Record<string, number> {
  const range: Record<string, number> = {};
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  for (let i = 12; i >= 0; i--) {
    range[`${ranks[i]}${ranks[i]}`] = 1; // all pairs
    for (let j = i - 1; j >= 0; j--) {
      const hi = ranks[i];
      const lo = ranks[j];
      const hiVal = i;
      const loVal = j;
      const gap = hiVal - loVal;
      if (hiVal >= 8) { // T or better high card
        range[`${hi}${lo}s`] = 1;
        if (loVal >= 7) range[`${hi}${lo}o`] = 1; // broadway offsuit
      } else if (gap <= 2 && hiVal >= 5) {
        range[`${hi}${lo}s`] = 1; // suited connectors
      }
    }
  }
  return range;
}
