// scenarioId は各ドリルページの component state から locally 再現可能な値のみを含める設計。
// record() 内部で払い出される ts (Date.now()) は呼び出し元から参照できないため、
// scenarioId を持たない attempt の problemKey (`${drillKind}:${ts}`) はブックマークボタンの
// キーとして再現できない（このため該当ドリルにはボタンを付けない、という判断の根拠になる）。
export type ProblemKeySource = {
  drillKind: string;
  scenarioId?: string;
  handClass?: string;
  ts?: number;
};

export function problemKeyOf(a: ProblemKeySource): string {
  if (a.scenarioId && a.handClass) return `${a.scenarioId}:${a.handClass}`;
  if (a.scenarioId) return a.scenarioId;
  return `${a.drillKind}:${a.ts}`;
}
