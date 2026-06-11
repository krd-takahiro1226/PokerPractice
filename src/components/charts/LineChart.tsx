type Props = {
  data: number[];
  width?: number;
  height?: number;
  baseline?: number;
};

/**
 * 軽量 SVG 折れ線グラフ。
 * - data: ハンドごとのスタック推移
 * - baseline: 開始スタック（水平線を描画）
 * - min/max ラベルのみ表示
 * - framer-motion 等の依存なし
 */
export function LineChart({ data, width = 480, height = 160, baseline }: Props) {
  if (data.length === 0) return null;

  const PADDING = { top: 16, right: 8, bottom: 24, left: 40 };
  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;

  const minVal = Math.min(...data);
  const maxVal = Math.max(...data);
  const range = maxVal - minVal || 1;

  const toX = (i: number) =>
    PADDING.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const toY = (v: number) =>
    PADDING.top + innerH - ((v - minVal) / range) * innerH;

  const points = data.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');

  const baselineY = baseline !== undefined
    ? PADDING.top + innerH - ((baseline - minVal) / range) * innerH
    : null;

  const lastX = toX(data.length - 1);
  const lastY = toY(data[data.length - 1]);
  const lastVal = data[data.length - 1];

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      aria-label="チップ推移グラフ"
    >
      {/* Y 軸ラベル */}
      <text
        x={PADDING.left - 4}
        y={PADDING.top + 4}
        textAnchor="end"
        fontSize="10"
        className="fill-current text-gray-400"
        fill="currentColor"
        opacity="0.6"
      >
        {maxVal.toFixed(0)}
      </text>
      <text
        x={PADDING.left - 4}
        y={PADDING.top + innerH}
        textAnchor="end"
        fontSize="10"
        className="fill-current text-gray-400"
        fill="currentColor"
        opacity="0.6"
      >
        {minVal.toFixed(0)}
      </text>

      {/* baseline 水平線（開始スタック） */}
      {baselineY !== null && (
        <line
          x1={PADDING.left}
          y1={baselineY}
          x2={PADDING.left + innerW}
          y2={baselineY}
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="4 3"
          opacity="0.3"
        />
      )}

      {/* 折れ線 */}
      <polyline
        points={points}
        fill="none"
        stroke="#34d399"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* 最終点 */}
      <circle cx={lastX} cy={lastY} r="3" fill="#34d399" />
      <text
        x={Math.min(lastX + 6, PADDING.left + innerW - 8)}
        y={lastY + 4}
        fontSize="10"
        fill="#34d399"
        opacity="0.9"
      >
        {lastVal.toFixed(0)}
      </text>

      {/* X 軸ラベル（0 と最終） */}
      <text
        x={PADDING.left}
        y={PADDING.top + innerH + 14}
        fontSize="9"
        fill="currentColor"
        opacity="0.4"
        textAnchor="middle"
      >
        0
      </text>
      <text
        x={PADDING.left + innerW}
        y={PADDING.top + innerH + 14}
        fontSize="9"
        fill="currentColor"
        opacity="0.4"
        textAnchor="middle"
      >
        {data.length - 1}
      </text>
    </svg>
  );
}
