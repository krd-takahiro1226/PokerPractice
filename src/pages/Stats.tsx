import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { useAttempts } from '../store/attempts';
import {
  overall, byDrillKind, byPosition, byHandClass, weakest, accuracyOf,
  type Bucket,
} from '../core/stats/aggregate';

const DRILL_KIND_LABEL: Record<string, string> = {
  range: 'レンジ訓練',
  quiz: 'クイズ',
  potOdds: 'ドロー判断',
  reqEquity: '必要勝率',
  mdf: 'MDF',
  cbet: 'CB',
  perceived: '相手目線レンジ',
};

function ProgressRing({ value, size = 80 }: { value: number; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * value;
  return (
    <svg width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={6} />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke="var(--color-accent)" strokeWidth={6}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
      />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" fontSize="14" fontWeight="bold" fill="var(--color-accent-bright)">
        {(value * 100).toFixed(0)}%
      </text>
    </svg>
  );
}

function BucketBar({ bucket, max }: { bucket: Bucket; max: number }) {
  const acc = accuracyOf(bucket);
  const width = max > 0 ? (bucket.attempts / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 text-muted">{DRILL_KIND_LABEL[bucket.key] ?? bucket.key}</span>
      <div className="flex-1 rounded-full bg-surface-2 h-2 overflow-hidden">
        <div className="h-full rounded-full bg-accent/70" style={{ width: `${width}%` }} />
      </div>
      <span className="w-16 text-right font-mono text-xs">{(acc * 100).toFixed(0)}% ({bucket.attempts})</span>
    </div>
  );
}

export function Stats() {
  const { attempts, loaded, load } = useAttempts();
  const [minN, setMinN] = useState(1);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  const ov = overall(attempts);
  const byKind = byDrillKind(attempts);
  const byPos = byPosition(attempts);
  const byHand = byHandClass(attempts);
  const weak = weakest(attempts, minN, 5);
  const maxKindAttempts = Math.max(...byKind.map((b) => b.attempts), 1);

  return (
    <div>
      <PageHeader title="学習統計" description="全ドリルの成績を一覧できます。" />
      <div className="space-y-6">
        <Panel title="全体正答率">
          <div className="flex items-center gap-6">
            <ProgressRing value={ov.attempts > 0 ? ov.correct / ov.attempts : 0} size={100} />
            <div>
              <p className="text-2xl font-bold font-mono">{ov.correct} / {ov.attempts}</p>
              <p className="text-muted text-sm">正解 / 総試行数</p>
            </div>
          </div>
        </Panel>

        <Panel title="ドリル種別">
          {byKind.length === 0 ? (
            <p className="text-muted text-sm">データなし</p>
          ) : (
            <div className="space-y-2">
              {byKind.map((b) => (
                <BucketBar key={b.key} bucket={b} max={maxKindAttempts} />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="ポジション別正答率">
          {byPos.length === 0 ? (
            <p className="text-muted text-sm">データなし</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted text-xs border-b border-border">
                  <th className="pb-2">ポジション</th>
                  <th className="pb-2 text-right">試行</th>
                  <th className="pb-2 text-right">正解</th>
                  <th className="pb-2 text-right">正答率</th>
                </tr>
              </thead>
              <tbody>
                {byPos.map((b) => (
                  <tr key={b.key} className="border-b border-border/40">
                    <td className="py-2 font-medium">{b.key}</td>
                    <td className="py-2 text-right font-mono">{b.attempts}</td>
                    <td className="py-2 text-right font-mono">{b.correct}</td>
                    <td className="py-2 text-right font-mono text-accent-bright">{(accuracyOf(b) * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="ハンド別正答率（上位10件）">
          {byHand.length === 0 ? (
            <p className="text-muted text-sm">データなし</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted text-xs border-b border-border">
                  <th className="pb-2">ハンド</th>
                  <th className="pb-2 text-right">試行</th>
                  <th className="pb-2 text-right">正答率</th>
                </tr>
              </thead>
              <tbody>
                {byHand.sort((a, b) => b.attempts - a.attempts).slice(0, 10).map((b) => (
                  <tr key={b.key} className="border-b border-border/40">
                    <td className="py-2 font-mono font-medium">{b.key}</td>
                    <td className="py-2 text-right font-mono">{b.attempts}</td>
                    <td className="py-2 text-right font-mono text-accent-bright">{(accuracyOf(b) * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="苦手シチュエーション（Top 5）">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-muted">最低試行数:</span>
            {[1, 3, 5, 10].map((n) => (
              <button
                key={n}
                onClick={() => setMinN(n)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition ${minN === n ? 'bg-accent text-[#04221a]' : 'border border-border text-muted hover:text-text'}`}
              >
                {n}
              </button>
            ))}
          </div>
          {weak.length === 0 ? (
            <p className="text-muted text-sm">十分なデータがありません（試行数フィルタを下げてみてください）</p>
          ) : (
            <div className="space-y-2">
              {weak.map((b) => (
                <div key={b.key} className="flex items-center justify-between rounded-lg border border-border/50 bg-surface-2/40 px-3 py-2 text-sm">
                  <span className="font-mono text-xs">{b.key}</span>
                  <span className="font-mono text-danger">{(accuracyOf(b) * 100).toFixed(0)}% ({b.attempts}問)</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
