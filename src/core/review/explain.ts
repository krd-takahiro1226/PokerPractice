const EXPLANATIONS: Record<string, string> = {
  'cfr-river-equilibrium': 'HU river サブゲームの CFR+ 均衡解に基づく頻度・EVです（レンジ仮定付き）',
  'cfr-turn-equilibrium': 'HU turn+river サブゲームの CFR+ 均衡解に基づく頻度・EVです（レンジ仮定付き）',
  'preflop-chart-raise': 'チャートでは raise が推奨頻度に含まれます',
  'preflop-chart-call': 'チャートでは call が推奨頻度に含まれます',
  'preflop-chart-fold': 'チャートでは fold が推奨頻度に含まれます',
  'preflop-solver-chart': 'ソルバー出力由来のチャート頻度です（出典はチャート情報を参照）',
  'preflop-squeeze-approx': 'squeeze スポット専用データが未整備のため vsOpen チャートで近似しています',
  'presolve-strategy': 'オフライン計算済みの GTO 均衡戦略（プリソルブDB）に基づく頻度です',
  'presolve-size-approx': '実戦のベットサイズを DB 内の最近傍サイズに丸めて照合しています（近似）',
};

/** explanationKeys → 日本語短文。未知キーは無視し、重複キーは1回だけ出す
 *  （候補ごとに同じキーが付くため、そのまま写すと同一文言が並ぶ）。 */
export function explainKeys(keys: string[]): string[] {
  return [...new Set(keys)]
    .map((key) => EXPLANATIONS[key])
    .filter((text): text is string => text !== undefined);
}
