import { explainKeys } from '../../../core/review/explain';
import { FrequencyBar } from './FrequencyBar';
import type { StrategyAdvice } from '../../../core/solver';
import type { PlayerActionType } from '../../../core/game/types';

const ACTION_LABEL: Record<PlayerActionType, string> = {
  fold: 'Fold',
  check: 'Check',
  call: 'Call',
  bet: 'Bet',
  raise: 'Raise',
  allin: 'All-in',
};

function formatCandidate(c: { action: PlayerActionType; sizeTo?: number; frequency: number }): string {
  const size = c.sizeTo !== undefined ? ` ${c.sizeTo.toFixed(1)}bb` : '';
  return `${ACTION_LABEL[c.action]}${size} (${(c.frequency * 100).toFixed(0)}%)`;
}

/** ヒーロー判断の GTO 解析詳細（展開時表示）。 */
export function DecisionAdviceDetail({ advice }: { advice: StrategyAdvice }) {
  const explanations = explainKeys(advice.candidates.flatMap((c) => c.explanationKeys));

  return (
    <div className="mt-2 flex flex-col gap-2 text-xs">
      <FrequencyBar candidates={advice.candidates} taken={advice.takenCandidate} />

      <div>
        <span className="text-muted">あなた: </span>
        <span className="font-semibold text-text">
          {advice.takenCandidate ? formatCandidate(advice.takenCandidate) : '候補外のアクション'}
        </span>
        <span className="text-muted"> → GTO: </span>
        <span className="text-text">{advice.candidates.map(formatCandidate).join(' / ')}</span>
      </div>

      {advice.evLossBB !== undefined && (
        <div>
          <span className="text-muted">EV差: </span>
          <span className={advice.evLossBB > 0 ? 'font-semibold text-rose-400' : 'font-semibold text-text'}>
            -{advice.evLossBB.toFixed(1)}bb
          </span>
        </div>
      )}

      {advice.source === 'cfr-exact' && advice.solution && (
        <>
          <div className="text-muted">
            解の誤差: <span className="text-text">{advice.solution.exploitabilityPctPot.toFixed(1)}% pot</span>
          </div>
          <details className="rounded border border-border/40 bg-surface-2/40 px-2 py-1.5">
            <summary className="cursor-pointer text-muted">仮定レンジを見る</summary>
            <div className="mt-1.5 flex flex-col gap-2">
              <RangeAssumptionView label="ヒーロー" assumption={advice.solution.heroRange} />
              <RangeAssumptionView label="相手" assumption={advice.solution.villainRange} />
            </div>
          </details>
        </>
      )}

      {explanations.length > 0 && (
        <ul className="list-inside list-disc text-muted">
          {explanations.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RangeAssumptionView({
  label,
  assumption,
}: {
  label: string;
  assumption: { label: string; combos?: number; note?: string };
}) {
  return (
    <div>
      <div className="font-semibold text-text">
        {label}: {assumption.label}
      </div>
      {assumption.combos !== undefined && (
        <div className="text-muted">コンボ数: {assumption.combos}</div>
      )}
      {assumption.note && <div className="text-muted">{assumption.note}</div>}
    </div>
  );
}
