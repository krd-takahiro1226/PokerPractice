import type { OnlinePlayer } from '../../core/online/tournament';

// Fixed categorical palette so each player keeps a stable, distinguishable line color
// without pulling in a full charting dependency for this one small SVG.
export const CHART_COLORS = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb7185'];

/**
 * 軽量 SVG 折れ線グラフ（複数プレイヤー版）。src/components/charts/LineChart.tsx の
 * スケーリング/baseline 方針を踏襲し、プレイヤーごとに色分けした polyline + 凡例を描く。
 */
export function MultiLineChart({ players }: { players: OnlinePlayer[] }) {
  const width = 480;
  const height = 200;
  const PADDING = { top: 16, right: 8, bottom: 24, left: 40 };
  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;

  const allValues = players.flatMap((p) => p.stackCurve);
  if (allValues.length === 0) return null;

  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal - minVal || 1;
  // 途中参加者の stackCurve は参加時点(hand番号)から始まり配列長が短い。インデックスではなく
  // 実ハンド番号の絶対軸でプロットしないと、参加タイミングが左端(開始点)にズレて見える(ON-9)。
  const allHands = players.flatMap((p) => p.stackCurveHands);
  const maxHand = allHands.length > 0 ? Math.max(...allHands) : 0;

  const toX = (hand: number) => PADDING.left + (maxHand === 0 ? innerW / 2 : (hand / maxHand) * innerW);
  const toY = (v: number) => PADDING.top + innerH - ((v - minVal) / range) * innerH;

  return (
    <div className="space-y-3">
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
        aria-label="チップ推移グラフ（全プレイヤー）"
      >
        <text x={PADDING.left - 4} y={PADDING.top + 4} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.6">
          {maxVal.toFixed(0)}
        </text>
        <text x={PADDING.left - 4} y={PADDING.top + innerH} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.6">
          {minVal.toFixed(0)}
        </text>
        {players.map((p, idx) => {
          const points = p.stackCurve
            .map((v, i) => `${toX(p.stackCurveHands[i] ?? i)},${toY(v)}`)
            .join(' ');
          const color = CHART_COLORS[idx % CHART_COLORS.length];
          return (
            <polyline
              key={p.uid}
              points={points}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-3">
        {players.map((p, idx) => (
          <div key={p.uid} className="flex items-center gap-1.5 text-xs text-muted">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
            />
            {p.displayName}
          </div>
        ))}
      </div>
    </div>
  );
}
