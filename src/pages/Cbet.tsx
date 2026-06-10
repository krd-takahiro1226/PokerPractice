import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import { PlayingCard } from '../components/PlayingCard';
import { FeedbackBanner } from '../components/FeedbackBanner';
import { StatBadge } from '../components/StatBadge';
import { CBET_QUESTIONS, type CbetQuestion, type CbetStrategy } from '../data/cbetQuestions';
import { pick } from '../lib/random';
import { cn } from '../lib/cn';
import { accuracy, useProgress } from '../store/progress';

const STRATEGY_LABEL: Record<CbetStrategy, string> = {
  high: '高頻度CB（レンジベット気味）',
  mixed: 'ミックス（約半分）',
  check: 'チェック多め',
};

const STRATEGIES: CbetStrategy[] = ['high', 'mixed', 'check'];

function nextQuestion(current?: CbetQuestion): CbetQuestion {
  if (CBET_QUESTIONS.length === 1) return CBET_QUESTIONS[0];
  let q = pick(CBET_QUESTIONS);
  while (current && q.id === current.id) q = pick(CBET_QUESTIONS);
  return q;
}

export function Cbet() {
  const recordCbet = useProgress((s) => s.recordCbet);
  const stats = useProgress((s) => s.cbet);
  const [q, setQ] = useState<CbetQuestion>(() => nextQuestion());
  const [answer, setAnswer] = useState<CbetStrategy | null>(null);

  const answered = answer !== null;
  const correct = answer === q.answer;

  function handleAnswer(value: CbetStrategy) {
    if (answered) return;
    setAnswer(value);
    recordCbet(value === q.answer);
  }

  function next() {
    setQ((cur) => nextQuestion(cur));
    setAnswer(null);
  }

  return (
    <div>
      <PageHeader
        title="フロップCBクイズ"
        description="シングルレイズドポットでのレンジ有利とCB頻度の感覚を鍛える。"
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <Panel>
          {/* scenario chip */}
          <div className="mb-4 flex flex-wrap gap-2">
            <span className="rounded-lg bg-surface-2 px-3 py-1 text-sm font-medium text-accent-bright">
              BTN open vs BB call
            </span>
          </div>

          {/* board cards */}
          <div className="my-6 flex items-center justify-center gap-3">
            <PlayingCard card={q.board[0]} size="lg" />
            <PlayingCard card={q.board[1]} size="lg" />
            <PlayingCard card={q.board[2]} size="lg" />
          </div>

          {/* texture chips */}
          <div className="mb-5 flex flex-wrap justify-center gap-1.5">
            {q.textures.map((t) => (
              <span
                key={t}
                className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent-bright"
              >
                {t}
              </span>
            ))}
          </div>

          <p className="mb-5 text-center text-sm text-muted">レンジ全体としてのCB戦略は？</p>

          {/* choices */}
          <div className="space-y-2.5">
            {STRATEGIES.map((strategy) => {
              const isAnswer = strategy === q.answer;
              const isChosen = strategy === answer;
              return (
                <button
                  key={strategy}
                  disabled={answered}
                  onClick={() => handleAnswer(strategy)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-left text-sm font-medium transition active:scale-[0.99]',
                    !answered && 'border-border bg-surface-2/40 hover:border-accent/50 hover:bg-surface-2',
                    answered && isAnswer && 'border-accent bg-accent/15 text-accent-bright',
                    answered && isChosen && !isAnswer && 'border-danger bg-danger/15 text-danger',
                    answered && !isAnswer && !isChosen && 'border-border bg-surface-2/20 text-muted',
                  )}
                >
                  {STRATEGY_LABEL[strategy]}
                  {answered && isAnswer && <span className="text-xs">正解</span>}
                </button>
              );
            })}
          </div>

          {answered && (
            <div className="mt-5 space-y-4">
              <FeedbackBanner correct={correct} title={correct ? '正解！' : `不正解 — 正解は「${STRATEGY_LABEL[q.answer]}」`}>
                {q.explanation}
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
              <li>どちらのレンジにナッツ級（セット・2ペア・ストレート等）が多いかを考える。</li>
              <li>BTNがAx/Kxを多く持つドライボード → 高頻度CB。</li>
              <li>BBのスーコネが刺さるミドル〜ロー連結 → チェック多め。</li>
              <li>両者が拮抗する中間的なボード → ミックス。</li>
            </ul>
            <p className="mt-3 text-xs text-muted">
              これは本物のソルバー出力ではなく、一般的なGTO傾向の近似です。実戦では相手の傾向に応じて調整しましょう。
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
