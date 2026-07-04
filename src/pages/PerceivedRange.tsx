import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import { RangeGrid, RangeLegend } from '../components/RangeGrid';
import { PlayingCard } from '../components/PlayingCard';
import { FeedbackBanner } from '../components/FeedbackBanner';
import { StatBadge } from '../components/StatBadge';
import { cn } from '../lib/cn';
import { pick, shuffle } from '../lib/random';
import { getRfiScenarios, primaryAction } from '../core/ranges';
import { openPercent } from '../core/ranges/expand';
import type { Scenario } from '../core/ranges/types';
import { ALL_HAND_CLASSES, handClassToCombos, type HandClass, type HoleCards } from '../core/handNotation';
import { accuracy, useProgress } from '../store/progress';
import { useAttempts } from '../store/attempts';

type Tab = 'inRange' | 'percent';

const INCLUDED = '含まれる';
const EXCLUDED = '含まれない';

function dealScenario(): Scenario {
  return pick(getRfiScenarios('tournament'));
}

export function PerceivedRange() {
  const [tab, setTab] = useState<Tab>('inRange');

  return (
    <div>
      <PageHeader
        title="相手目線レンジ"
        description="自分のアクションが相手にどんなレンジを見せているかを意識する訓練。"
      />

      <div className="mb-5 inline-flex rounded-xl border border-border bg-surface-2/50 p-1">
        {(['inRange', 'percent'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition',
              tab === t ? 'bg-accent text-[#04221a]' : 'text-muted hover:text-text',
            )}
          >
            {t === 'inRange' ? 'レンジ内？' : 'レンジ%当て'}
          </button>
        ))}
      </div>

      {tab === 'inRange' ? <InRangeDrill /> : <PercentDrill />}
    </div>
  );
}

type InRangeQuestion = { scenario: Scenario; hand: HandClass; cards: HoleCards };

// 169クラスから一様に引くと大半が「含まれない」になるため、レンジ内/外を半々で出題する
function dealInRange(): InRangeQuestion {
  const scenario = dealScenario();
  const inRange = ALL_HAND_CLASSES.filter((h) => primaryAction(scenario.range[h]) === 'raise');
  const outRange = ALL_HAND_CLASSES.filter((h) => primaryAction(scenario.range[h]) !== 'raise');
  const pool = Math.random() < 0.5 && inRange.length > 0 ? inRange : outRange;
  const hand = pick(pool.length > 0 ? pool : [...ALL_HAND_CLASSES]);
  const cards = pick(handClassToCombos(hand));
  return { scenario, hand, cards };
}

function InRangeDrill() {
  const recordPerceived = useProgress((s) => s.recordPerceived);
  const stats = useProgress((s) => s.perceived);
  const record = useAttempts((s) => s.record);
  const [q, setQ] = useState<InRangeQuestion>(() => dealInRange());
  const [answer, setAnswer] = useState<string | null>(null);

  const expected = primaryAction(q.scenario.range[q.hand]) === 'raise' ? INCLUDED : EXCLUDED;
  const answered = answer !== null;
  const correct = answer === expected;

  function handleAnswer(choice: string) {
    if (answered) return;
    setAnswer(choice);
    const isCorrect = choice === expected;
    recordPerceived(isCorrect);
    record({
      drillKind: 'perceived',
      scenarioId: q.scenario.id,
      position: q.scenario.heroPos,
      handClass: q.hand,
      expected,
      answered: choice,
      correct: isCorrect,
    });
  }

  function next() {
    setQ(dealInRange());
    setAnswer(null);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Panel>
        <div className="text-sm text-muted">
          あなたは <span className="font-semibold text-text">{q.scenario.label}</span>。
          相手から見て、この <span className="font-mono text-accent-bright">{q.hand}</span> は
          あなたが見せているオープンレンジに含まれる?
        </div>

        <div className="my-6 flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <PlayingCard card={q.cards[0]} size="lg" />
            <PlayingCard card={q.cards[1]} size="lg" />
          </div>
          <div className="font-mono text-sm text-muted">{q.hand}</div>
        </div>

        {!answered ? (
          <div className="mt-6 grid grid-cols-2 gap-3">
            <Button variant="subtle" size="lg" onClick={() => handleAnswer(INCLUDED)}>
              {INCLUDED}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => handleAnswer(EXCLUDED)}>
              {EXCLUDED}
            </Button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <FeedbackBanner
              correct={correct}
              title={correct ? '正解！' : `不正解 — 正解は「${expected}」`}
            >
              あなたの実際のハンドが何であれ、相手にはこのレンジ全体に見えています。
            </FeedbackBanner>
            <RangeGrid range={q.scenario.range} highlight={q.hand} />
            <RangeLegend />
            <Button onClick={next} className="w-full" size="lg">
              次の問題
            </Button>
          </div>
        )}
      </Panel>

      <div className="space-y-4">
        <Panel title="このシナリオのレンジ" className="hidden lg:block">
          {answered ? (
            <>
              <RangeGrid range={q.scenario.range} highlight={q.hand} />
              <div className="mt-3"><RangeLegend /></div>
            </>
          ) : (
            <p className="text-xs text-muted">回答するとレンジが表示されます。</p>
          )}
        </Panel>
        <div className="grid grid-cols-3 gap-3">
          <StatBadge label="正答率" value={`${(accuracy(stats) * 100).toFixed(0)}%`} accent="accent" />
          <StatBadge label="連続正解" value={stats.streak} accent="gold" />
          <StatBadge label="問題数" value={stats.attempts} accent="muted" />
        </div>
      </div>
    </div>
  );
}

type PercentQuestion = { scenario: Scenario; correctPct: number; options: number[] };

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, n));
}

function dealPercent(): PercentQuestion {
  const scenario = dealScenario();
  const correctPct = Math.round(openPercent(scenario.range) * 100);
  const candidates = [
    correctPct,
    Math.round(correctPct * 0.5),
    Math.round(correctPct * 1.5),
    Math.round(correctPct * 2.2),
  ];
  const used = new Set<number>();
  const options = candidates.map((c) => {
    let v = clampPct(c);
    while (used.has(v)) {
      v = v < 100 ? clampPct(v + 1) : clampPct(v - 1);
    }
    used.add(v);
    return v;
  });
  return { scenario, correctPct, options: shuffle(options) };
}

function PercentDrill() {
  const recordPerceived = useProgress((s) => s.recordPerceived);
  const stats = useProgress((s) => s.perceived);
  const record = useAttempts((s) => s.record);
  const [q, setQ] = useState<PercentQuestion>(() => dealPercent());
  const [answer, setAnswer] = useState<number | null>(null);

  const answered = answer !== null;
  const correct = answer === q.correctPct;

  function handleAnswer(choice: number) {
    if (answered) return;
    setAnswer(choice);
    const isCorrect = choice === q.correctPct;
    recordPerceived(isCorrect);
    record({
      drillKind: 'perceived',
      scenarioId: q.scenario.id,
      position: q.scenario.heroPos,
      expected: String(q.correctPct),
      answered: String(choice),
      correct: isCorrect,
    });
  }

  function next() {
    setQ(dealPercent());
    setAnswer(null);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Panel>
        <div className="text-sm text-muted">
          あなたは <span className="font-semibold text-text">{q.scenario.heroPos}</span> からオープンした。
          相手から見たあなたのレンジは全スターティングハンドの約何%?
        </div>

        {!answered ? (
          <div className="mt-6 grid grid-cols-2 gap-3">
            {q.options.map((opt) => (
              <Button key={opt} variant="subtle" size="lg" onClick={() => handleAnswer(opt)}>
                {opt}%
              </Button>
            ))}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <FeedbackBanner
              correct={correct}
              title={correct ? '正解！' : `不正解 — 正解は「${q.correctPct}%」`}
            >
              タイトなポジションほど見せるレンジが狭い（＝強く見える）。
            </FeedbackBanner>
            <RangeGrid range={q.scenario.range} />
            <RangeLegend percent={q.correctPct / 100} />
            <Button onClick={next} className="w-full" size="lg">
              次の問題
            </Button>
          </div>
        )}
      </Panel>

      <div className="space-y-4">
        <Panel title="このシナリオのレンジ" className="hidden lg:block">
          {answered ? (
            <>
              <RangeGrid range={q.scenario.range} />
              <div className="mt-3"><RangeLegend percent={q.correctPct / 100} /></div>
            </>
          ) : (
            <p className="text-xs text-muted">回答するとレンジが表示されます。</p>
          )}
        </Panel>
        <div className="grid grid-cols-3 gap-3">
          <StatBadge label="正答率" value={`${(accuracy(stats) * 100).toFixed(0)}%`} accent="accent" />
          <StatBadge label="連続正解" value={stats.streak} accent="gold" />
          <StatBadge label="問題数" value={stats.attempts} accent="muted" />
        </div>
      </div>
    </div>
  );
}
