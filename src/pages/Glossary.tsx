import { useState, useMemo } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { cn } from '../lib/cn';
import { GLOSSARY, type GlossaryCategory, type GlossaryTerm } from '../data/glossary';

const CATEGORIES: GlossaryCategory[] = [
  '基本', 'ポジション', 'プリフロップ', 'ポストフロップ',
  '役・ハンド', 'ベッティング', '数学・理論',
];

export function Glossary() {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<GlossaryCategory | 'すべて'>('すべて');

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return GLOSSARY.filter((t) => {
      const matchesQuery =
        q === '' ||
        t.term.toLowerCase().includes(q) ||
        t.kana.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q);
      const matchesCategory =
        activeCategory === 'すべて' || t.category === activeCategory;
      return matchesQuery && matchesCategory;
    });
  }, [query, activeCategory]);

  // Group filtered results by category
  const grouped = useMemo(() => {
    const map = new Map<GlossaryCategory, GlossaryTerm[]>();
    for (const cat of CATEGORIES) map.set(cat, []);
    for (const term of filtered) {
      map.get(term.category)!.push(term);
    }
    return map;
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="用語集"
        description="ポーカーの基本用語を日本語で解説。検索やカテゴリで絞り込めます。"
      />

      {/* 検索ボックス */}
      <div className="mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="用語・カナ・説明で検索..."
          className="w-full max-w-md rounded-xl border border-border bg-surface-2/50 px-4 py-2 text-sm text-text placeholder:text-muted focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
        />
      </div>

      {/* カテゴリフィルタ */}
      <div className="mb-5 flex flex-wrap gap-2">
        {(['すべて', ...CATEGORIES] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              'rounded-xl border px-3 py-1 text-xs font-medium transition',
              activeCategory === cat
                ? 'border-accent bg-accent/15 text-accent-bright'
                : 'border-border bg-surface-2/40 text-muted hover:text-text',
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* ヒット件数 */}
      <p className="mb-4 text-xs text-muted">
        {filtered.length} 件の用語が見つかりました
      </p>

      {/* 0件 */}
      {filtered.length === 0 && (
        <Panel>
          <p className="py-8 text-center text-sm text-muted">該当する用語がありません</p>
        </Panel>
      )}

      {/* カテゴリ別表示 */}
      {filtered.length > 0 && (
        <div className="space-y-6">
          {CATEGORIES.map((cat) => {
            const terms = grouped.get(cat) ?? [];
            if (terms.length === 0) return null;
            return (
              <div key={cat}>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted/70">
                  {cat}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {terms.map((t) => (
                    <TermCard key={t.term} term={t} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TermCard({ term }: { term: GlossaryTerm }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-4 transition hover:border-border-bright">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-base font-bold text-text">{term.term}</span>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">
          {term.category}
        </span>
      </div>
      <div className="mt-0.5 text-[11px] text-muted">{term.kana}</div>
      <p className="mt-2 text-xs leading-relaxed text-text/80">{term.description}</p>
      {term.example && (
        <p className="mt-2 rounded-lg bg-bg/60 px-3 py-1.5 text-[11px] text-muted">
          例: {term.example}
        </p>
      )}
    </div>
  );
}
