import { useEffect, useState } from 'react';
import { Bookmark } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { useAttempts } from '../store/attempts';
import { useBookmarks } from '../store/bookmarks';
import { cn } from '../lib/cn';
import type { QuizAttempt } from '../store/attempts';

const DRILL_KIND_LABEL: Record<string, string> = {
  range: 'レンジ訓練',
  quiz: 'クイズ',
  potOdds: 'ドロー判断',
  reqEquity: '必要勝率',
  mdf: 'MDF',
  cbet: 'CB',
  perceived: '相手目線レンジ',
};

type ReviewMode = 'mistakes' | 'bookmarks';

export function Review() {
  const { attempts, loaded: attLoaded, load: loadAttempts } = useAttempts();
  const { items: bookmarkItems, loaded: bmLoaded, load: loadBookmarks, toggle, has } = useBookmarks();
  const [mode, setMode] = useState<ReviewMode>('mistakes');

  useEffect(() => {
    if (!attLoaded) loadAttempts();
    if (!bmLoaded) loadBookmarks();
  }, [attLoaded, bmLoaded, loadAttempts, loadBookmarks]);

  const mistakes = [...attempts].filter((a) => !a.correct).sort(byTsDesc);
  const bookmarkedKeys = new Set(bookmarkItems.map((i) => i.problemKey));
  const bookmarkedAttempts = dedupeByProblemKey(
    attempts.filter((a) => bookmarkedKeys.has(problemKeyOf(a))),
  ).sort(byTsDesc);

  const displayList = mode === 'mistakes' ? mistakes : bookmarkedAttempts;

  return (
    <div>
      <PageHeader title="復習" description="間違えた問題やブックマークした問題を振り返る。" />
      <div className="mb-4 inline-flex rounded-xl border border-border bg-surface-2/50 p-1">
        {(['mistakes', 'bookmarks'] as ReviewMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition',
              mode === m ? 'bg-accent text-[#04221a]' : 'text-muted hover:text-text',
            )}
          >
            {m === 'mistakes' ? `間違い (${mistakes.length})` : `ブックマーク (${bookmarkedAttempts.length})`}
          </button>
        ))}
      </div>

      {displayList.length === 0 ? (
        <Panel>
          <p className="text-muted text-sm text-center py-8">
            {mode === 'mistakes' ? 'まだ間違いがありません。ドリルをやってみよう！' : 'ブックマークがありません。間違いリストから追加できます。'}
          </p>
        </Panel>
      ) : (
        <div className="space-y-3">
          {displayList.map((attempt) => {
            const key = problemKeyOf(attempt);
            const isBookmarked = has(key);
            return (
              <Panel key={`${attempt.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="rounded bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                        {DRILL_KIND_LABEL[attempt.drillKind] ?? attempt.drillKind}
                      </span>
                      {attempt.position && (
                        <span className="text-xs text-muted">{attempt.position}</span>
                      )}
                      {attempt.handClass && (
                        <span className="font-mono text-xs text-text">{attempt.handClass}</span>
                      )}
                      {attempt.scenarioId && (
                        <span className="text-xs text-muted/60 truncate">{attempt.scenarioId}</span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-sm">
                      <div>
                        <span className="text-muted text-xs">正解: </span>
                        <span className="font-mono text-accent-bright">{attempt.expected}</span>
                      </div>
                      <div>
                        <span className="text-muted text-xs">あなたの回答: </span>
                        <span className={cn('font-mono', attempt.correct ? 'text-accent-bright' : 'text-danger')}>
                          {attempt.answered}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => toggle(key)}
                    className={cn(
                      'shrink-0 rounded-lg p-1.5 transition',
                      isBookmarked ? 'text-gold' : 'text-muted hover:text-text',
                    )}
                    title={isBookmarked ? 'ブックマーク解除' : 'ブックマーク'}
                  >
                    <Bookmark size={16} fill={isBookmarked ? 'currentColor' : 'none'} />
                  </button>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function problemKeyOf(a: QuizAttempt): string {
  if (a.scenarioId && a.handClass) return `${a.scenarioId}:${a.handClass}`;
  if (a.scenarioId) return a.scenarioId;
  return `${a.drillKind}:${a.ts}`;
}

export function byTsDesc(a: QuizAttempt, b: QuizAttempt): number {
  return b.ts - a.ts;
}

export function dedupeByProblemKey(list: QuizAttempt[]): QuizAttempt[] {
  const latest = new Map<string, QuizAttempt>();
  for (const a of list) {
    const key = problemKeyOf(a);
    const existing = latest.get(key);
    if (!existing || a.ts > existing.ts) latest.set(key, a);
  }
  return [...latest.values()];
}
