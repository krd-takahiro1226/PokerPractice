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
import {
  getRfiScenarios,
  GAME_MODES,
  GAME_MODE_SHORT,
  TIERS,
  maxTierFor,
  type Action,
  type Scenario,
  primaryAction,
} from '../core/ranges';
import type { GameMode } from '../core/ranges/mode';
import { openPercent } from '../core/ranges/expand';
import { accuracy, useProgress } from '../store/progress';

type Tab = 'chart' | 'drill';

const ACTION_LABEL: Record<Action, string> = { raise: 'オープン (レイズ)', call: 'コール', fold: 'フォールド' };

type Drill = { scenario: Scenario; cards: HoleCards; hand: string };

function dealDrill(mode: GameMode): Drill {
  const scenarios = getRfiScenarios(mode);
  const scenario = pick(scenarios);
  const [c1, c2] = shuffle(makeDeck()).slice(0, 2) as HoleCards;
  return { scenario, cards: [c1, c2], hand: cardsToHandClass(c1, c2) };
}

// ティアカラー（ヨコサワの色に寄せる）
const TIER_COLORS = [
  'bg-blue-900 text-blue-100',        // tier1 紺
  'bg-red-700 text-red-100',          // tier2 赤
  'bg-yellow-500 text-yellow-900',    // tier3 黄
  'bg-green-600 text-green-100',      // tier4 緑
  'bg-blue-500 text-blue-100',        // tier5 青
  'bg-gray-100 text-gray-900',        // tier6 白
  'bg-purple-600 text-purple-100',    // tier7 紫
];
const TIER_NAMES = ['tier1（紺）', 'tier2（赤）', 'tier3（黄）', 'tier4（緑）', 'tier5（青）', 'tier6（白）', 'tier7（紫）'];

export function RangeTrainer() {
  const [tab, setTab] = useState<Tab>('chart');
  const [mode, setMode] = useState<GameMode>('tournament');

  return (
    <div>
      <PageHeader
        title="プリフロップ・レンジ訓練"
        description="6-max 100bb のオープンレンジ。まずチャートで形を覚え、ドリルで反復しよう。"
      />

      {/* タブ */}
      <div className="mb-3 inline-flex rounded-xl border border-border bg-surface-2/50 p-1">
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

      {/* モードセレクタ */}
      <div className="mb-5 flex items-center gap-2">
        <span className="text-xs text-muted">モード:</span>
        {GAME_MODES.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              'rounded-lg px-3 py-1 text-xs font-medium transition',
              mode === m
                ? 'bg-accent text-[#04221a]'
                : 'border border-border text-muted hover:text-text',
            )}
          >
            {GAME_MODE_SHORT[m]}
          </button>
        ))}
      </div>

      {tab === 'chart' ? <ChartView mode={mode} /> : <DrillView mode={mode} />}
    </div>
  );
}

function ChartView({ mode }: { mode: GameMode }) {
  const scenarios = getRfiScenarios(mode);
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0];
  const pct = useMemo(() => openPercent(scenario.range), [scenario]);

  const activeMaxTier = maxTierFor(mode, scenario.heroPos);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {scenarios.map((s) => (
          <button
            key={s.id}
            onClick={() => setScenarioId(s.id)}
            className={cn(
              'rounded-xl border px-4 py-2 text-sm font-medium transition',
              s.id === scenario.id
                ? 'border-accent bg-accent/15 text-accent-bright'
                : 'border-border bg-surface-2/40 text-muted hover:text-text',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <Panel>
            <PositionTable hero={scenario.heroPos} />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <StatBadge label="ポジション" value={scenario.heroPos} accent="accent" />
              <StatBadge label="オープンサイズ" value={`${scenario.sizeBB}bb`} accent="muted" />
            </div>
          </Panel>

          {/* ティア早見表 */}
          <Panel title="ティア構成">
            <p className="mb-2 text-[11px] text-muted">
              後ろの人数 → 使用ティア（累積）
              {mode === 'cash-noante' && (
                <span className="ml-1 text-amber-400">アンティなし: 最広ティア除外</span>
              )}
            </p>
            <div className="space-y-1.5">
              {TIERS.map((hands, idx) => {
                const tierNum = idx + 1; // 1始まり
                const isActive = tierNum <= activeMaxTier;
                return (
                  <div
                    key={tierNum}
                    className={cn(
                      'group rounded-lg px-2 py-1.5 text-[11px] transition',
                      isActive ? TIER_COLORS[idx] : 'bg-surface-2/30 text-muted line-through opacity-40',
                    )}
                    title={hands.join(', ')}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{TIER_NAMES[idx]}</span>
                      <span className="font-mono opacity-80">{hands.length}手</span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] opacity-70">
                      {hands.slice(0, 6).join(' ')}
                      {hands.length > 6 && ` …+${hands.length - 6}`}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-muted">
              BB defense は全モード共通（モード非依存）
            </p>
          </Panel>
        </div>

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

function DrillView({ mode }: { mode: GameMode }) {
  const recordRange = useProgress((s) => s.recordRange);
  const stats = useProgress((s) => s.range);
  const [drill, setDrill] = useState<Drill>(() => dealDrill(mode));
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
    setDrill(dealDrill(mode));
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
