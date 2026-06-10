import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import { RangeGrid, RangeLegend } from '../components/RangeGrid';
import { PositionTable } from '../components/PositionTable';
import { PlayingCard } from '../components/PlayingCard';
import { ActionButtons } from '../components/ActionButtons';
import { FeedbackBanner } from '../components/FeedbackBanner';
import { StatBadge } from '../components/StatBadge';
import { cn } from '../lib/cn';
import { pick, shuffle } from '../lib/random';
import { makeDeck } from '../core/cards';
import { cardsToHandClass, type HoleCards } from '../core/handNotation';
import { RFI_SCENARIOS, type Action, type Scenario, primaryAction } from '../core/ranges';
import { openPercent } from '../core/ranges/expand';
import { accuracy, useProgress } from '../store/progress';

type Tab = 'chart' | 'drill';

const ACTION_LABEL: Record<Action, string> = { raise: 'オープン (レイズ)', call: 'コール', fold: 'フォールド' };

type Drill = { scenario: Scenario; cards: HoleCards; hand: string };

function dealDrill(): Drill {
  const scenario = pick(RFI_SCENARIOS);
  const [c1, c2] = shuffle(makeDeck()).slice(0, 2) as HoleCards;
  return { scenario, cards: [c1, c2], hand: cardsToHandClass(c1, c2) };
}

export function RangeTrainer() {
  const [tab, setTab] = useState<Tab>('chart');
  return (
    <div>
      <PageHeader
        title="プリフロップ・レンジ訓練"
        description="6-max 100bb のオープンレンジ。まずチャートで形を覚え、ドリルで反復しよう。"
      />
      <div className="mb-5 inline-flex rounded-xl border border-border bg-surface-2/50 p-1">
        {(['chart', 'drill'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition',
              tab === t ? 'bg-accent text-[#04221a]' : 'text-muted hover:text-text',
            )}
          >
            {t === 'chart' ? 'チャート閲覧' : 'ドリル'}
          </button>
        ))}
      </div>
      {tab === 'chart' ? <ChartView /> : <DrillView />}
    </div>
  );
}

function ChartView() {
  const [scenarioId, setScenarioId] = useState(RFI_SCENARIOS[0].id);
  const scenario = RFI_SCENARIOS.find((s) => s.id === scenarioId)!;
  const pct = useMemo(() => openPercent(scenario.range), [scenario]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {RFI_SCENARIOS.map((s) => (
          <button
            key={s.id}
            onClick={() => setScenarioId(s.id)}
            className={cn(
              'rounded-xl border px-4 py-2 text-sm font-medium transition',
              s.id === scenarioId
                ? 'border-accent bg-accent/15 text-accent-bright'
                : 'border-border bg-surface-2/40 text-muted hover:text-text',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <Panel>
          <PositionTable hero={scenario.heroPos} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <StatBadge label="ポジション" value={scenario.heroPos} accent="accent" />
            <StatBadge label="オープンサイズ" value={`${scenario.sizeBB}bb`} accent="muted" />
          </div>
        </Panel>
        <Panel>
          <RangeGrid range={scenario.range} />
          <div className="mt-4">
            <RangeLegend percent={pct} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function DrillView() {
  const recordRange = useProgress((s) => s.recordRange);
  const stats = useProgress((s) => s.range);
  const [drill, setDrill] = useState<Drill>(() => dealDrill());
  const [answer, setAnswer] = useState<Action | null>(null);

  const expected = primaryAction(drill.scenario.range[drill.hand]);
  const answered = answer !== null;
  const correct = answer === expected;

  function handleAnswer(a: Action) {
    if (answered) return;
    setAnswer(a);
    recordRange(drill.scenario.id, a === expected);
  }

  function next() {
    setDrill(dealDrill());
    setAnswer(null);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Panel>
        <div className="flex items-center justify-between">
          <span className="rounded-lg bg-surface-2 px-3 py-1 text-sm font-medium text-accent-bright">
            {drill.scenario.label}
          </span>
          <span className="text-sm text-muted">フォールドされてあなたにアクションが回ってきた</span>
        </div>

        <div className="my-8 flex flex-col items-center gap-4">
          <PositionTable hero={drill.scenario.heroPos} className="max-w-xs" />
          <div className="flex items-center gap-3">
            <PlayingCard card={drill.cards[0]} size="lg" />
            <PlayingCard card={drill.cards[1]} size="lg" />
          </div>
          <div className="font-mono text-sm text-muted">{drill.hand}</div>
        </div>

        {!answered ? (
          <ActionButtons
            options={[
              { action: 'fold', label: 'フォールド' },
              { action: 'raise', label: 'オープン' },
            ]}
            onSelect={handleAnswer}
          />
        ) : (
          <div className="space-y-4">
            <FeedbackBanner
              correct={correct}
              title={correct ? '正解！' : `不正解 — 正解は「${ACTION_LABEL[expected]}」`}
            >
              {drill.scenario.label}で <span className="font-mono text-text">{drill.hand}</span> は
              <span className={expected === 'raise' ? 'text-accent-bright' : 'text-muted'}>
                {' '}
                {ACTION_LABEL[expected]}
              </span>
              。
            </FeedbackBanner>
            <Button onClick={next} className="w-full" size="lg">
              次のハンド
            </Button>
          </div>
        )}
      </Panel>

      <div className="space-y-4">
        <Panel title="このシナリオのレンジ" className="hidden lg:block">
          <RangeGrid range={drill.scenario.range} highlight={answered ? drill.hand : null} />
          {answered && <div className="mt-3"><RangeLegend /></div>}
        </Panel>
        <div className="grid grid-cols-3 gap-3">
          <StatBadge label="正答率" value={`${(accuracy(stats) * 100).toFixed(0)}%`} accent="accent" />
          <StatBadge label="連続正解" value={stats.streak} accent="gold" />
          <StatBadge label="問題数" value={stats.attempts} accent="muted" />
        </div>
        <Button variant="ghost" size="sm" onClick={() => useProgress.getState().reset()} className="w-full">
          <RotateCcw size={14} /> 進捗をリセット
        </Button>
      </div>
    </div>
  );
}
