import { useState } from 'react';
import { Coins } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import { ActionButtons } from '../components/ActionButtons';
import { FeedbackBanner } from '../components/FeedbackBanner';
import { StatBadge } from '../components/StatBadge';
import {
  DRAW_TYPES,
  equityFromOuts,
  genImpliedDrill,
  genMdfDrill,
  genReqEquityDrill,
  mdf,
  potOdds,
  requiredImpliedAmount,
  ruleOfThumb,
  type ImpliedDrill,
  type MdfDrill,
  type ReqEquityDrill,
} from '../core/potOdds';
import type { Action } from '../core/ranges/types';
import { pick, randInt } from '../lib/random';
import { cn } from '../lib/cn';
import { accuracy, useProgress } from '../store/progress';
import { useAttempts } from '../store/attempts';

type Tab = 'draw' | 'reqEquity' | 'mdf' | 'implied';

type DrawDrill = {
  pot: number;
  toCall: number;
  outs: number;
  drawLabel: string;
  street: 'flop' | 'turn';
};

function genDrawDrill(): DrawDrill {
  const draw = pick(DRAW_TYPES);
  const street = pick(['flop', 'turn'] as const);
  const pot = randInt(4, 30) * 10;
  const toCall = Math.max(10, Math.round((pot * (0.3 + Math.random() * 0.7)) / 10) * 10);
  return { pot, toCall, outs: draw.outs, drawLabel: draw.label, street };
}

export function PotOdds() {
  const [tab, setTab] = useState<Tab>('draw');

  return (
    <div>
      <PageHeader
        title="ポットオッズ & MDF"
        description="コール判断・必要勝率・MDF（最低守備頻度）をまとめて練習。"
      />
      <div className="mb-5 inline-flex rounded-xl border border-border bg-surface-2/50 p-1">
        {(['draw', 'reqEquity', 'mdf', 'implied'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition',
              tab === t ? 'bg-accent text-[#04221a]' : 'text-muted hover:text-text',
            )}
          >
            {t === 'draw'
              ? 'ドロー判断'
              : t === 'reqEquity'
                ? '必要勝率'
                : t === 'mdf'
                  ? 'MDF'
                  : 'インプライドオッズ'}
          </button>
        ))}
      </div>
      {tab === 'draw' && <DrawView />}
      {tab === 'reqEquity' && <ReqEquityView />}
      {tab === 'mdf' && <MdfView />}
      {tab === 'implied' && <ImpliedView />}
    </div>
  );
}

// ─── ドロー判断タブ（既存ロジック） ──────────────────────────────────────────

function DrawView() {
  const recordPotOdds = useProgress((s) => s.recordPotOdds);
  const stats = useProgress((s) => s.potOdds);
  const record = useAttempts((s) => s.record);
  const [drill, setDrill] = useState<DrawDrill>(() => genDrawDrill());
  const [answer, setAnswer] = useState<Action | null>(null);

  const cardsToCome = drill.street === 'flop' ? 2 : 1;
  const required = potOdds(drill.pot, drill.toCall);
  const actual = equityFromOuts(drill.outs, cardsToCome);
  const rot = ruleOfThumb(drill.outs, cardsToCome);
  const shouldCall = actual >= required;
  const answered = answer !== null;
  const correct = answered && (answer === 'call') === shouldCall;

  function handleAnswer(a: Action) {
    if (answered) return;
    setAnswer(a);
    recordPotOdds((a === 'call') === shouldCall);
    record({
      drillKind: 'potOdds',
      scenarioId: `potOdds:pot=${drill.pot},call=${drill.toCall},outs=${drill.outs},street=${drill.street}`,
      expected: shouldCall ? 'call' : 'fold',
      answered: a,
      correct: (a === 'call') === shouldCall,
    });
  }

  function next() {
    setDrill(genDrawDrill());
    setAnswer(null);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <Panel>
        <div className="rounded-2xl border border-border bg-gradient-to-b from-surface-2/60 to-bg/40 p-6">
          <div className="flex items-center justify-center gap-8">
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-muted">ポット（相手のベット込み）</div>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-3xl font-bold text-gold tabular-nums">
                <Coins size={22} /> {drill.pot}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-muted">相手のベット</div>
              <div className="mt-1 font-mono text-3xl font-bold text-danger tabular-nums">{drill.toCall}</div>
            </div>
          </div>
          <div className="mt-5 flex flex-col items-center gap-1 border-t border-border pt-4">
            <span className="text-sm text-muted">
              {drill.street === 'flop' ? 'フロップ' : 'ターン'}・あなたのドロー
            </span>
            <span className="font-semibold">{drill.drawLabel}</span>
            <span className="rounded-full bg-accent/15 px-3 py-0.5 font-mono text-sm text-accent-bright">
              {drill.outs} アウツ
            </span>
          </div>
        </div>

        <p className="mt-3 text-center text-xs text-muted">
          ※ ポットには相手のベット額がすでに含まれています
        </p>

        <p className="my-5 text-center text-sm text-muted">このドローをコールすべき？</p>

        {!answered ? (
          <ActionButtons
            options={[
              { action: 'fold', label: 'フォールド' },
              { action: 'call', label: 'コール' },
            ]}
            onSelect={handleAnswer}
          />
        ) : (
          <div className="space-y-4">
            <FeedbackBanner
              correct={correct}
              title={correct ? '正解！' : `不正解 — 正しくは「${shouldCall ? 'コール' : 'フォールド'}」`}
            >
              <div className="grid grid-cols-3 gap-3 pt-1">
                <Metric label="必要勝率" value={`${(required * 100).toFixed(1)}%`} note="ポットオッズ" />
                <Metric label="実際の勝率" value={`${(actual * 100).toFixed(1)}%`} note="アウツから厳密" highlight />
                <Metric label="2&4の法則" value={`${(rot * 100).toFixed(0)}%`} note="概算" />
              </div>
              <p className="mt-3">
                必要勝率 {(required * 100).toFixed(1)}% に対し実勝率は {(actual * 100).toFixed(1)}%。
                {shouldCall ? ' 勝率が上回るのでコールが正当化されます。' : ' 勝率が足りずフォールドが正解です。'}
              </p>
            </FeedbackBanner>
            <Button onClick={next} size="lg" className="w-full">
              次の問題
            </Button>
          </div>
        )}
      </Panel>

      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 lg:grid-cols-1">
          <StatBadge label="正答率" value={`${(accuracy(stats) * 100).toFixed(0)}%`} accent="gold" />
          <StatBadge label="連続正解" value={stats.streak} accent="accent" />
          <StatBadge label="問題数" value={stats.attempts} accent="muted" />
        </div>
        <Panel className="hidden lg:block">
          <h3 className="text-sm font-semibold">考え方</h3>
          <ul className="mt-2 space-y-2 text-xs text-muted">
            <li>必要勝率 = コール額 ÷ (ポット + コール額)</li>
            <li>2&4の法則: フロップは アウツ×4、ターンは アウツ×2 (%)</li>
            <li>実勝率 ≥ 必要勝率 なら コール</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

// ─── 必要勝率タブ ─────────────────────────────────────────────────────────────

function ReqEquityView() {
  const recordReqEquity = useProgress((s) => s.recordReqEquity);
  const stats = useProgress((s) => s.reqEquity);
  const record = useAttempts((s) => s.record);
  const [drill, setDrill] = useState<ReqEquityDrill>(() => genReqEquityDrill());
  const [chosen, setChosen] = useState<number | null>(null);

  const answered = chosen !== null;
  const correct = answered && Math.abs(chosen - drill.answer) < 0.001;

  function handleAnswer(value: number) {
    if (answered) return;
    const isCorrect = Math.abs(value - drill.answer) < 0.001;
    setChosen(value);
    recordReqEquity(isCorrect);
    record({
      drillKind: 'reqEquity',
      scenarioId: `reqEquity:pot=${drill.pot},bet=${drill.bet}`,
      expected: `${(drill.answer * 100).toFixed(1)}%`,
      answered: `${(value * 100).toFixed(1)}%`,
      correct: isCorrect,
    });
  }

  function next() {
    setDrill(genReqEquityDrill());
    setChosen(null);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <Panel>
        <div className="rounded-2xl border border-border bg-gradient-to-b from-surface-2/60 to-bg/40 p-6">
          <div className="flex items-center justify-center gap-8">
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-muted">ポット（相手のベット込み）</div>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-3xl font-bold text-gold tabular-nums">
                <Coins size={22} /> {drill.pot}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-muted">相手のベット</div>
              <div className="mt-1 font-mono text-3xl font-bold text-danger tabular-nums">{drill.bet}</div>
            </div>
          </div>
        </div>

        <p className="mt-3 text-center text-xs text-muted">
          ※ ポットには相手のベット額がすでに含まれています
        </p>

        <p className="my-5 text-center text-sm text-muted">コールに必要な勝率は？</p>

        <div className="space-y-2.5">
          {drill.choices.map((value) => {
            const isAnswer = Math.abs(value - drill.answer) < 0.001;
            const isChosen = chosen !== null && Math.abs(value - chosen) < 0.001;
            return (
              <button
                key={value}
                disabled={answered}
                onClick={() => handleAnswer(value)}
                className={cn(
                  'flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-left text-sm font-medium transition active:scale-[0.99]',
                  !answered && 'border-border bg-surface-2/40 hover:border-accent/50 hover:bg-surface-2',
                  answered && isAnswer && 'border-accent bg-accent/15 text-accent-bright',
                  answered && isChosen && !isAnswer && 'border-danger bg-danger/15 text-danger',
                  answered && !isAnswer && !isChosen && 'border-border bg-surface-2/20 text-muted',
                )}
              >
                {(value * 100).toFixed(1)}%
                {answered && isAnswer && <span className="text-xs">正解</span>}
              </button>
            );
          })}
        </div>

        {answered && (
          <div className="mt-5 space-y-4">
            <FeedbackBanner correct={correct} title={correct ? '正解！' : '不正解'}>
              <p className="mt-1 font-mono text-sm">
                必要勝率 = コール額 ÷ (ポット + コール額)
                <br />
                = {drill.bet} ÷ ({drill.pot} + {drill.bet})
                <br />
                = {drill.bet} ÷ {drill.pot + drill.bet}
                <br />= {(drill.answer * 100).toFixed(1)}%
              </p>
            </FeedbackBanner>
            <Button onClick={next} size="lg" className="w-full">
              次の問題
            </Button>
          </div>
        )}
      </Panel>

      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 lg:grid-cols-1">
          <StatBadge label="正答率" value={`${(accuracy(stats) * 100).toFixed(0)}%`} accent="gold" />
          <StatBadge label="連続正解" value={stats.streak} accent="accent" />
          <StatBadge label="問題数" value={stats.attempts} accent="muted" />
        </div>
        <Panel className="hidden lg:block">
          <h3 className="text-sm font-semibold">考え方</h3>
          <ul className="mt-2 space-y-2 text-xs text-muted">
            <li>必要勝率 = コール額 ÷ (ポット + コール額)</li>
            <li>これ以上の勝率がなければコールは損</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

// ─── MDFタブ ──────────────────────────────────────────────────────────────────

const MDF_TABLE = [
  { size: '1/3 pot', pct: '75%' },
  { size: '1/2 pot', pct: '67%' },
  { size: '2/3 pot', pct: '60%' },
  { size: 'pot', pct: '50%' },
  { size: '2x pot', pct: '33%' },
];

function MdfView() {
  const recordMdf = useProgress((s) => s.recordMdf);
  const stats = useProgress((s) => s.mdf);
  const record = useAttempts((s) => s.record);
  const [drill, setDrill] = useState<MdfDrill>(() => genMdfDrill());
  const [chosen, setChosen] = useState<number | null>(null);

  const answered = chosen !== null;
  const correct = answered && Math.abs(chosen - drill.answer) < 0.001;

  function handleAnswer(value: number) {
    if (answered) return;
    const isCorrect = Math.abs(value - drill.answer) < 0.001;
    setChosen(value);
    recordMdf(isCorrect);
    record({
      drillKind: 'mdf',
      scenarioId: `mdf:pot=${drill.pot},bet=${drill.bet}`,
      expected: `${(drill.answer * 100).toFixed(1)}%`,
      answered: `${(value * 100).toFixed(1)}%`,
      correct: isCorrect,
    });
  }

  function next() {
    setDrill(genMdfDrill());
    setChosen(null);
  }

  // Sanity-check: recompute answer from pot/bet for display
  const displayAnswer = mdf(drill.pot, drill.bet);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <Panel>
        <div className="rounded-2xl border border-border bg-gradient-to-b from-surface-2/60 to-bg/40 p-6">
          <div className="flex items-center justify-center gap-8">
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-muted">ポット（相手のベット前）</div>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-3xl font-bold text-gold tabular-nums">
                <Coins size={22} /> {drill.pot}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-muted">相手のベット</div>
              <div className="mt-1 font-mono text-3xl font-bold text-danger tabular-nums">{drill.bet}</div>
            </div>
          </div>
        </div>

        <p className="mt-3 text-center text-xs text-muted">
          ※ 相手はこのポットに対してベットしています（ポットにベット額は含まれません）
        </p>

        <p className="my-5 text-center text-sm text-muted">
          あなたのレンジの最低何%を守るべき？(MDF)
        </p>

        <div className="space-y-2.5">
          {drill.choices.map((value) => {
            const isAnswer = Math.abs(value - drill.answer) < 0.001;
            const isChosen = chosen !== null && Math.abs(value - chosen) < 0.001;
            return (
              <button
                key={value}
                disabled={answered}
                onClick={() => handleAnswer(value)}
                className={cn(
                  'flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-left text-sm font-medium transition active:scale-[0.99]',
                  !answered && 'border-border bg-surface-2/40 hover:border-accent/50 hover:bg-surface-2',
                  answered && isAnswer && 'border-accent bg-accent/15 text-accent-bright',
                  answered && isChosen && !isAnswer && 'border-danger bg-danger/15 text-danger',
                  answered && !isAnswer && !isChosen && 'border-border bg-surface-2/20 text-muted',
                )}
              >
                {(value * 100).toFixed(1)}%
                {answered && isAnswer && <span className="text-xs">正解</span>}
              </button>
            );
          })}
        </div>

        {answered && (
          <div className="mt-5 space-y-4">
            <FeedbackBanner correct={correct} title={correct ? '正解！' : '不正解'}>
              <p className="mt-1 font-mono text-sm">
                MDF = ポット ÷ (ポット + ベット額)
                <br />
                = {drill.pot} ÷ ({drill.pot} + {drill.bet})
                <br />
                = {drill.pot} ÷ {drill.pot + drill.bet}
                <br />= {(displayAnswer * 100).toFixed(0)}%
              </p>
              <p className="mt-3 text-xs text-muted">
                相手のブラフを自動的に不利益（EV0以下）にする最低防御頻度。これより多く降りると、相手はどんな2枚でもブラフして利益を得られる。
              </p>
            </FeedbackBanner>
            <Button onClick={next} size="lg" className="w-full">
              次の問題
            </Button>
          </div>
        )}
      </Panel>

      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 lg:grid-cols-1">
          <StatBadge label="正答率" value={`${(accuracy(stats) * 100).toFixed(0)}%`} accent="gold" />
          <StatBadge label="連続正解" value={stats.streak} accent="accent" />
          <StatBadge label="問題数" value={stats.attempts} accent="muted" />
        </div>
        <Panel className="hidden lg:block">
          <h3 className="text-sm font-semibold">ベットサイズ別 MDF</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
            <dt className="text-muted">ベット</dt>
            <dd className="text-muted">MDF</dd>
            {MDF_TABLE.map(({ size, pct }) => (
              <>
                <dt key={`s-${size}`} className="text-text">{size}</dt>
                <dd key={`p-${size}`} className="text-accent-bright">{pct}</dd>
              </>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}

// ─── インプライドオッズ判断タブ ────────────────────────────────────────────

function ImpliedView() {
  const recordPotOdds = useProgress((s) => s.recordPotOdds);
  const stats = useProgress((s) => s.potOdds);
  const record = useAttempts((s) => s.record);
  const [drill, setDrill] = useState<ImpliedDrill>(() => genImpliedDrill());
  const [answer, setAnswer] = useState<Action | null>(null);

  const cardsToCome = drill.street === 'flop' ? 2 : 1;
  const required = potOdds(drill.pot, drill.toCall);
  const equity = equityFromOuts(drill.outs, cardsToCome);
  const expectedCollect = drill.collectFactor * drill.behindStack;
  const shouldCall = drill.answer === 'call';
  const answered = answer !== null;
  const correct = answered && (answer === 'call') === shouldCall;

  const factorLabel =
    drill.collectFactor === 0.3 ? '読まれやすい' : drill.collectFactor === 0.5 ? '隠れやすい' : '回収が難しい';

  function handleAnswer(a: Action) {
    if (answered) return;
    setAnswer(a);
    recordPotOdds((a === 'call') === shouldCall);
    record({
      drillKind: 'potOdds',
      scenarioId: `implied:pot=${drill.pot},call=${drill.toCall},outs=${drill.outs},behind=${drill.behindStack}`,
      expected: shouldCall ? 'call' : 'fold',
      answered: a,
      correct: (a === 'call') === shouldCall,
    });
  }

  function next() {
    setDrill(genImpliedDrill());
    setAnswer(null);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <Panel>
        <div className="rounded-2xl border border-border bg-gradient-to-b from-surface-2/60 to-bg/40 p-6">
          <div className="flex items-center justify-center gap-6">
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-muted">ポット（相手のベット込み）</div>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-3xl font-bold text-gold tabular-nums">
                <Coins size={22} /> {drill.pot}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-muted">相手のベット</div>
              <div className="mt-1 font-mono text-3xl font-bold text-danger tabular-nums">{drill.toCall}</div>
            </div>
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-muted">相手の残りスタック</div>
              <div className="mt-1 font-mono text-3xl font-bold text-text tabular-nums">{drill.behindStack}</div>
            </div>
          </div>
          <div className="mt-5 flex flex-col items-center gap-1 border-t border-border pt-4">
            <span className="text-sm text-muted">
              {drill.street === 'flop' ? 'フロップ' : 'ターン'}・あなたのドロー
            </span>
            <span className="font-semibold">{drill.drawLabel}</span>
            <span className="rounded-full bg-accent/15 px-3 py-0.5 font-mono text-sm text-accent-bright">
              {drill.outs} アウツ
            </span>
          </div>
        </div>

        <p className="my-5 text-center text-sm text-muted">
          {equity >= required
            ? '将来の回収も踏まえて、このドローをコールすべき？'
            : '直接オッズでは足りません。将来の回収を見込んでコールすべき？'}
        </p>

        {!answered ? (
          <ActionButtons
            options={[
              { action: 'fold', label: 'フォールド' },
              { action: 'call', label: 'コール' },
            ]}
            onSelect={handleAnswer}
          />
        ) : (
          <div className="space-y-4">
            <FeedbackBanner
              correct={correct}
              title={correct ? '正解！' : `不正解 — 正しくは「${shouldCall ? 'コール' : 'フォールド'}」`}
            >
              <div className="grid grid-cols-2 gap-3 pt-1">
                <Metric label="必要勝率" value={`${(required * 100).toFixed(1)}%`} note="ポットオッズ" />
                <Metric label="実際の勝率" value={`${(equity * 100).toFixed(1)}%`} note="アウツから厳密" highlight />
                <Metric label="必要追加回収額" value={`${drill.requiredExtra.toFixed(0)}`} note="不足を埋めるX" />
                <Metric
                  label="見込み回収額"
                  value={`${expectedCollect.toFixed(0)}`}
                  note={`${(drill.collectFactor * 100).toFixed(0)}% × 残りスタック`}
                  highlight
                />
              </div>
              <p className="mt-3">
                このドローは{factorLabel}ため回収期待は残りスタックの約{(drill.collectFactor * 100).toFixed(0)}%。
                {shouldCall
                  ? ` 見込み回収額が必要追加回収額を上回るのでコールが正当化されます。`
                  : ` 見込み回収額では必要追加回収額を埋められずフォールドが正解です。`}
              </p>
              <p className="mt-3 text-xs text-muted">
                ※ これは簡易モデルによる目安であり、厳密なソルバー解ではありません。
              </p>
            </FeedbackBanner>
            <Button onClick={next} size="lg" className="w-full">
              次の問題
            </Button>
          </div>
        )}
      </Panel>

      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 lg:grid-cols-1">
          <StatBadge label="正答率" value={`${(accuracy(stats) * 100).toFixed(0)}%`} accent="gold" />
          <StatBadge label="連続正解" value={stats.streak} accent="accent" />
          <StatBadge label="問題数" value={stats.attempts} accent="muted" />
        </div>
        <Panel className="hidden lg:block">
          <h3 className="text-sm font-semibold">考え方</h3>
          <ul className="mt-2 space-y-2 text-xs text-muted">
            <li>追加回収必要額 = コール額 ÷ 実勝率 −（ポット + コール額）</li>
            <li>隠れたドローほど回収期待が大きい（フラッシュは読まれやすく回収が少なめ）</li>
            <li>見込み回収額 ≥ 必要追加回収額 なら コール</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Metric({ label, value, note, highlight }: { label: string; value: string; note: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-bg/40 px-2 py-2 text-center">
      <div className="text-[10px] text-muted">{label}</div>
      <div className={`font-mono text-lg font-bold tabular-nums ${highlight ? 'text-accent-bright' : 'text-text'}`}>
        {value}
      </div>
      <div className="text-[9px] text-muted">{note}</div>
    </div>
  );
}
