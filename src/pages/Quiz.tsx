import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import { PlayingCard } from '../components/PlayingCard';
import { PositionTable } from '../components/PositionTable';
import { FeedbackBanner } from '../components/FeedbackBanner';
import { StatBadge } from '../components/StatBadge';
import { QUIZ_QUESTIONS, type QuizQuestion } from '../data/quizQuestions';
import { handClassToCombos } from '../core/handNotation';
import { pick } from '../lib/random';
import { cn } from '../lib/cn';
import { accuracy, useProgress } from '../store/progress';
import { useAttempts } from '../store/attempts';

function nextQuestion(current?: QuizQuestion): QuizQuestion {
  if (QUIZ_QUESTIONS.length === 1) return QUIZ_QUESTIONS[0];
  let q = pick(QUIZ_QUESTIONS);
  while (current && q.id === current.id) q = pick(QUIZ_QUESTIONS);
  return q;
}

export function Quiz() {
  const recordQuiz = useProgress((s) => s.recordQuiz);
  const stats = useProgress((s) => s.quiz);
  const record = useAttempts((s) => s.record);
  const [q, setQ] = useState<QuizQuestion>(() => nextQuestion());
  const [answer, setAnswer] = useState<string | null>(null);

  const answered = answer !== null;
  const correct = answer === q.answer;
  const cards = q.context?.hand ? handClassToCombos(q.context.hand)[0] : null;

  function handleAnswer(value: string) {
    if (answered) return;
    setAnswer(value);
    recordQuiz(value === q.answer);
    record({
      drillKind: 'quiz',
      scenarioId: q.id,
      expected: q.answer,
      answered: value,
      correct: value === q.answer,
    });
  }

  function next() {
    setQ((cur) => nextQuestion(cur));
    setAnswer(null);
  }

  return (
    <div>
      <PageHeader title="ハンドクイズ" description="状況に対する最適なアクションを選び、解説で理解を深めよう。" />
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <Panel>
          {q.context?.heroPos && <PositionTable hero={q.context.heroPos} className="mb-5 max-w-xs" />}

          {cards && (
            <div className="mb-5 flex items-center justify-center gap-3">
              <PlayingCard card={cards[0]} size="lg" />
              <PlayingCard card={cards[1]} size="lg" />
            </div>
          )}

          <p className="mb-5 text-center text-base leading-relaxed">{q.prompt}</p>

          <div className="space-y-2.5">
            {q.choices.map((choice) => {
              const isAnswer = choice.value === q.answer;
              const isChosen = choice.value === answer;
              return (
                <button
                  key={choice.value}
                  disabled={answered}
                  onClick={() => handleAnswer(choice.value)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 text-left text-sm font-medium transition active:scale-[0.99]',
                    !answered && 'border-border bg-surface-2/40 hover:border-accent/50 hover:bg-surface-2',
                    answered && isAnswer && 'border-accent bg-accent/15 text-accent-bright',
                    answered && isChosen && !isAnswer && 'border-danger bg-danger/15 text-danger',
                    answered && !isAnswer && !isChosen && 'border-border bg-surface-2/20 text-muted',
                  )}
                >
                  {choice.label}
                  {answered && isAnswer && <span className="text-xs">正解</span>}
                </button>
              );
            })}
          </div>

          {answered && (
            <div className="mt-5 space-y-4">
              <FeedbackBanner correct={correct} title={correct ? '正解！' : '不正解'}>
                {q.explanation}
              </FeedbackBanner>
              <Button onClick={next} size="lg" className="w-full">
                次の問題
              </Button>
            </div>
          )}
        </Panel>

        <div className="grid grid-cols-3 gap-3 lg:grid-cols-1">
          <StatBadge label="正答率" value={`${(accuracy(stats) * 100).toFixed(0)}%`} accent="call" />
          <StatBadge label="連続正解" value={stats.streak} accent="accent" />
          <StatBadge label="問題数" value={stats.attempts} accent="muted" />
        </div>
      </div>
    </div>
  );
}
