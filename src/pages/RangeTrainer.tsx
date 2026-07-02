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
import { cardsToHandClass, type HoleCards, type HandClass } from '../core/handNotation';
import {
  getRfiScenarios,
  GAME_MODES,
  GAME_MODE_SHORT,
  TIERS,
  maxTierFor,
  type Action,
  primaryAction,
} from '../core/ranges';
import type { GameMode } from '../core/ranges/mode';
import { openPercent } from '../core/ranges/expand';
import { accuracy, useProgress } from '../store/progress';
import { getVsOpenScenariosForSeats, type VsOpenSeatScenario } from '../core/ranges/vsOpen';
import { seatLabels, getRfiScenariosForSeats, type SeatScenario } from '../core/ranges/seats';
import type { Range } from '../core/ranges/types';
import type { Position } from '../core/ranges/types';
import { getEffectiveRange, rfiKey, vsOpenKey } from '../core/ranges/effective';
import { useCustomRanges } from '../store/customRanges';
import { useAttempts } from '../store/attempts';

type Tab = 'chart' | 'drill';
type ChartKind = 'rfi' | 'vsOpen';

const ACTION_LABEL: Record<Action, string> = { raise: 'オープン (レイズ)', call: 'コール', fold: 'フォールド' };

type DrillScenario = { id: string; label: string; heroPos: string; range: Range };
type Drill = { scenario: DrillScenario; cards: HoleCards; hand: string };

function dealDrill(mode: GameMode, seatCount: number): Drill {
  const scenarios: DrillScenario[] = seatCount === 6
    ? getRfiScenarios(mode)
    : getRfiScenariosForSeats(seatCount, mode);
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

const TIER_CELL_COLORS: { bg: string; fg: string }[] = [
  { bg: '#1e3a8a', fg: '#dbeafe' }, // tier1
  { bg: '#b91c1c', fg: '#fee2e2' }, // tier2
  { bg: '#eab308', fg: '#713f12' }, // tier3
  { bg: '#16a34a', fg: '#dcfce7' }, // tier4
  { bg: '#3b82f6', fg: '#dbeafe' }, // tier5
  { bg: '#f3f4f6', fg: '#111827' }, // tier6
  { bg: '#9333ea', fg: '#f3e8ff' }, // tier7
];

export function RangeTrainer() {
  const [tab, setTab] = useState<Tab>('chart');
  const [mode, setMode] = useState<GameMode>('tournament');
  const [seatCount, setSeatCount] = useState<number>(6);

  return (
    <div>
      <PageHeader
        title="プリフロップ・レンジ訓練"
        description="2〜10人テーブル・100bb のオープンレンジ。まずチャートで形を覚え、ドリルで反復しよう。"
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
      <div className="mb-3 flex items-center gap-2">
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

      {/* 人数セレクタ */}
      <div className="mb-5 flex items-center gap-2">
        <span className="text-xs text-muted">人数:</span>
        <SeatCountSelector seatCount={seatCount} onChange={setSeatCount} />
      </div>

      {tab === 'chart' ? (
        <ChartView mode={mode} seatCount={seatCount} />
      ) : (
        <DrillView key={`${mode}:${seatCount}`} mode={mode} seatCount={seatCount} />
      )}

      <div className="mt-5 flex items-center gap-2">
        <span className="text-xs text-muted">人数を切り替えて比較:</span>
        <SeatCountSelector seatCount={seatCount} onChange={setSeatCount} />
      </div>
    </div>
  );
}

function SeatCountSelector({ seatCount, onChange }: { seatCount: number; onChange: (n: number) => void }) {
  return (
    <>
      {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={cn(
            'rounded-lg px-2.5 py-1 text-xs font-medium transition',
            seatCount === n
              ? 'bg-accent text-[#04221a]'
              : 'border border-border text-muted hover:text-text',
          )}
        >
          {n}
        </button>
      ))}
    </>
  );
}

function ChartView({ mode, seatCount }: { mode: GameMode; seatCount: number }) {
  const [chartKind, setChartKind] = useState<ChartKind>('rfi');
  const [editMode, setEditMode] = useState(false);
  const [colorMode, setColorMode] = useState<'action' | 'tier'>('action');
  const { ranges: customRanges, setRange, resetRange } = useCustomRanges();
  const is6max = seatCount === 6;

  // RFI 用シナリオ
  const rfiScenarios = useMemo(
    () => getRfiScenariosForSeats(seatCount, mode),
    [mode, seatCount],
  );

  const [rfiScenarioId, setRfiScenarioId] = useState<string>('');
  const activeRfiScenario: SeatScenario | undefined =
    rfiScenarios.find((s) => s.id === rfiScenarioId) ?? rfiScenarios[0];

  // vs-open 用
  const vsOpenScenarios = useMemo(() => getVsOpenScenariosForSeats(seatCount), [seatCount]);
  const [vsOpenIdx, setVsOpenIdx] = useState<number>(0);
  // 人数変更でシナリオ数が減ったとき選択を先頭に戻す
  const effectiveVsOpenIdx = vsOpenIdx < vsOpenScenarios.length ? vsOpenIdx : 0;
  const vsOpenScenario: VsOpenSeatScenario | undefined = vsOpenScenarios[effectiveVsOpenIdx];

  const currentKey = chartKind === 'rfi' && is6max
    ? rfiKey(activeRfiScenario?.heroPos as Position)
    : chartKind === 'vsOpen' && is6max
      ? vsOpenKey(vsOpenScenario?.villainPos as Position, vsOpenScenario?.heroPos as Position)
      : null;

  const activeRange = useMemo(() => {
    if (currentKey) {
      return getEffectiveRange(currentKey, mode, customRanges) ?? {};
    }
    if (chartKind === 'rfi') return activeRfiScenario?.range ?? {};
    return vsOpenScenario?.range ?? {};
  }, [currentKey, mode, customRanges, chartKind, activeRfiScenario, vsOpenScenario]);

  const hasCustom = currentKey ? (!!customRanges[currentKey] && Object.keys(customRanges[currentKey]!).length > 0) : false;

  const pct = useMemo(
    () => chartKind === 'rfi' ? openPercent(activeRange) : undefined,
    [chartKind, activeRange],
  );

  const activeMaxTier: number | undefined = (() => {
    if (chartKind === 'rfi') {
      if (is6max) return maxTierFor(mode, activeRfiScenario?.heroPos as any);
      return activeRfiScenario?.maxTier;
    }
    // vsOpen
    return vsOpenScenario?.callMaxTier;
  })();

  // tier color map for RFI tier mode
  const tierCellColors = useMemo(() => {
    if (colorMode !== 'tier' || chartKind !== 'rfi' || activeMaxTier === undefined) return undefined;
    const colors: Partial<Record<HandClass, { bg: string; fg: string }>> = {};
    TIERS.slice(0, activeMaxTier).forEach((hands, tierIdx) => {
      const c = TIER_CELL_COLORS[tierIdx];
      for (const h of hands) colors[h as HandClass] = c;
    });
    return colors;
  }, [colorMode, chartKind, activeMaxTier]);

  function handleCellClick(hand: string) {
    if (!editMode || !is6max || chartKind !== 'rfi' || !currentKey) return;
    const current = activeRange[hand];
    const pa = primaryAction(current);
    const next = pa === 'raise' ? 'call' : pa === 'call' ? 'fold' : 'raise';
    const newRange = { ...activeRange };
    if (next === 'fold') {
      delete newRange[hand];
    } else {
      newRange[hand] = next === 'raise' ? { raise: 1 } : { call: 1 };
    }
    setRange(currentKey, newRange);
  }

  return (
    <div className="space-y-5">
      {/* チャート種別セレクタ */}
      <div className="flex items-center gap-3">
        <div className="inline-flex rounded-xl border border-border bg-surface-2/50 p-1">
          <button
            onClick={() => setChartKind('rfi')}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition',
              chartKind === 'rfi' ? 'bg-accent text-[#04221a]' : 'text-muted hover:text-text',
            )}
          >
            RFI
          </button>
          <button
            onClick={() => setChartKind('vsOpen')}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition',
              chartKind === 'vsOpen' ? 'bg-accent text-[#04221a]' : 'text-muted hover:text-text',
            )}
          >
            vs open ディフェンス
          </button>
        </div>
      </div>

      {/* シナリオセレクタ */}
      {chartKind === 'rfi' ? (
        <div className="flex flex-wrap gap-2">
          {rfiScenarios.map((s) => (
            <button
              key={s.id}
              onClick={() => setRfiScenarioId(s.id)}
              className={cn(
                'rounded-xl border px-4 py-2 text-sm font-medium transition',
                s.id === activeRfiScenario?.id
                  ? 'border-accent bg-accent/15 text-accent-bright'
                  : 'border-border bg-surface-2/40 text-muted hover:text-text',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {vsOpenScenarios.map((s, idx) => (
            <button
              key={s.id}
              onClick={() => setVsOpenIdx(idx)}
              className={cn(
                'rounded-xl border px-4 py-2 text-sm font-medium transition',
                idx === effectiveVsOpenIdx
                  ? 'border-accent bg-accent/15 text-accent-bright'
                  : 'border-border bg-surface-2/40 text-muted hover:text-text',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          {chartKind === 'rfi' && activeRfiScenario && (
            <Panel>
              <PositionTable
                hero={activeRfiScenario.heroPos}
                seats={seatLabels(seatCount)}
              />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <StatBadge label="ポジション" value={activeRfiScenario.heroPos} accent="accent" />
                <StatBadge label="オープンサイズ" value={`${activeRfiScenario.sizeBB}bb`} accent="muted" />
              </div>
            </Panel>
          )}

          {chartKind === 'vsOpen' && vsOpenScenario && (
            <Panel>
              <PositionTable
                hero={vsOpenScenario.heroPos}
                seats={seatLabels(seatCount)}
                highlightVillain={[vsOpenScenario.villainPos]}
              />
              <div className="mt-3 space-y-1 text-sm">
                <div><span className="text-muted">opener: </span><span className="font-semibold">{vsOpenScenario.villainPos}</span></div>
                <div><span className="text-muted">hero: </span><span className="font-semibold">{vsOpenScenario.heroPos}</span></div>
              </div>
              <p className="mt-3 text-[11px] text-muted">vs open は全モード共通（モード非依存）</p>
            </Panel>
          )}

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
                const tierNum = idx + 1;
                const isActive = activeMaxTier !== undefined ? tierNum <= activeMaxTier : false;
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
            {chartKind === 'vsOpen' && (
              <div className="mt-2 space-y-1 text-[10px] text-muted">
                <p>raise=3bet（緑）、call（青）、fold（灰）</p>
                <p>vs open は全モード共通</p>
              </div>
            )}
            {chartKind === 'rfi' && (
              <p className="mt-2 text-[10px] text-muted">
                BB defense は全モード共通（モード非依存）
              </p>
            )}
          </Panel>
        </div>

        <Panel>
          {is6max && chartKind === 'rfi' && (
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setEditMode((v) => !v)}
                className={cn(
                  'rounded-lg px-3 py-1 text-xs font-medium transition',
                  editMode ? 'bg-accent text-[#04221a]' : 'border border-border text-muted hover:text-text',
                )}
              >
                {editMode ? '編集中' : '編集'}
              </button>
              {hasCustom && (
                <>
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent-bright">カスタム</span>
                  <button
                    onClick={() => currentKey && resetRange(currentKey)}
                    className="rounded-lg px-2 py-0.5 text-xs text-muted hover:text-danger transition"
                  >
                    リセット
                  </button>
                </>
              )}
              {editMode && <span className="text-[10px] text-muted">セルをクリックで raise→call→fold 切替</span>}
            </div>
          )}
          {chartKind === 'rfi' && !editMode && (
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs text-muted">色分け:</span>
              <button
                onClick={() => setColorMode('action')}
                className={cn(
                  'rounded-lg px-3 py-1 text-xs font-medium transition',
                  colorMode === 'action' ? 'bg-accent text-[#04221a]' : 'border border-border text-muted hover:text-text',
                )}
              >
                アクション
              </button>
              <button
                onClick={() => setColorMode('tier')}
                className={cn(
                  'rounded-lg px-3 py-1 text-xs font-medium transition',
                  colorMode === 'tier' ? 'bg-accent text-[#04221a]' : 'border border-border text-muted hover:text-text',
                )}
              >
                ティア
              </button>
            </div>
          )}
          <RangeGrid
            range={activeRange}
            onCellClick={editMode && is6max && chartKind === 'rfi' ? handleCellClick : undefined}
            cellColors={tierCellColors}
          />
          <div className="mt-4">
            {colorMode === 'tier' && chartKind === 'rfi' ? (
              <TierLegend activeMaxTier={activeMaxTier} />
            ) : (
              <RangeLegend percent={pct} />
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function TierLegend({ activeMaxTier }: { activeMaxTier: number | undefined }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      {TIER_CELL_COLORS.map((c, idx) => {
        const tierNum = idx + 1;
        const isActive = activeMaxTier !== undefined ? tierNum <= activeMaxTier : false;
        return (
          <span
            key={tierNum}
            className={cn('inline-flex items-center gap-1.5', !isActive && 'opacity-30')}
          >
            <span
              className="h-3 w-3 rounded-sm"
              style={{ background: c.bg, border: '1px solid rgba(255,255,255,0.1)' }}
            />
            tier{tierNum}
          </span>
        );
      })}
    </div>
  );
}

function DrillView({ mode, seatCount }: { mode: GameMode; seatCount: number }) {
  const recordRange = useProgress((s) => s.recordRange);
  const stats = useProgress((s) => s.range);
  const record = useAttempts((s) => s.record);
  const [drill, setDrill] = useState<Drill>(() => dealDrill(mode, seatCount));
  const [answer, setAnswer] = useState<Action | null>(null);

  const expected = primaryAction(drill.scenario.range[drill.hand]);
  const answered = answer !== null;
  const correct = answer === expected;

  function handleAnswer(a: Action) {
    if (answered) return;
    setAnswer(a);
    recordRange(drill.scenario.id, a === expected);
    record({
      drillKind: 'range',
      scenarioId: drill.scenario.id,
      position: drill.scenario.heroPos,
      handClass: drill.hand,
      expected,
      answered: a,
      correct: a === expected,
    });
  }

  function next() {
    setDrill(dealDrill(mode, seatCount));
    setAnswer(null);
  }

  const drillSeats = seatCount !== 6 ? seatLabels(seatCount) : undefined;

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
          <PositionTable
            hero={drill.scenario.heroPos}
            seats={drillSeats}
            className="max-w-xs"
          />
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
