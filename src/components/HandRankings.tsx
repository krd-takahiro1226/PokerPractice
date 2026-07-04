import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { PlayingCard } from './PlayingCard';
import type { Card } from '../core/cards';
import { cn } from '../lib/cn';

// 表示用の10役（強い順）。アプリ内部のカテゴリは9種で、ロイヤルは
// ストレートフラッシュの最高形だが、初心者向け一覧としては別の行で見せる。
// name は evaluator.ts の CATEGORY_NAME と表記を揃えること。
export const HAND_RANKINGS: { name: string; desc: string; example: Card[] }[] = [
  {
    name: 'ロイヤルストレートフラッシュ',
    desc: '同じスート（柄）の 10・J・Q・K・A。ストレートフラッシュの最高形',
    example: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
  },
  {
    name: 'ストレートフラッシュ',
    desc: '5枚すべて同じスートで、数字が連続している',
    example: ['9s', '8s', '7s', '6s', '5s'],
  },
  {
    name: 'フォーカード',
    desc: '同じ数字のカードが4枚',
    example: ['9s', '9h', '9d', '9c', 'Kd'],
  },
  {
    name: 'フルハウス',
    desc: '同じ数字3枚（スリーカード）と、別の数字2枚（ペア）の組み合わせ',
    example: ['Ks', 'Kh', 'Kd', '4h', '4s'],
  },
  {
    name: 'フラッシュ',
    desc: '5枚すべて同じスート（柄）。数字は連続していなくてよい',
    example: ['As', 'Ts', '7s', '4s', '2s'],
  },
  {
    name: 'ストレート',
    desc: '数字が5枚連続している。スートはバラバラでよい',
    example: ['9d', '8s', '7h', '6c', '5d'],
  },
  {
    name: 'スリーカード',
    desc: '同じ数字のカードが3枚',
    example: ['7s', '7h', '7d', 'Ks', '2c'],
  },
  {
    name: 'ツーペア',
    desc: '同じ数字2枚の組（ペア）が2組',
    example: ['Ks', 'Kh', '8d', '8c', '3s'],
  },
  {
    name: 'ワンペア',
    desc: '同じ数字のカードが2枚',
    example: ['Js', 'Jh', '9d', '6c', '2s'],
  },
  {
    name: 'ハイカード',
    desc: '上のどれにも当てはまらない。いちばん強い1枚（＋キッカー）で勝負',
    example: ['As', 'Kd', '9h', '6c', '2s'],
  },
];

export function HandRankingsList() {
  return (
    <div className="space-y-3">
      {HAND_RANKINGS.map((h, i) => (
        <div
          key={h.name}
          className="rounded-lg border border-border/60 bg-surface-2/30 px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="w-6 shrink-0 text-right font-mono text-xs text-muted">{i + 1}</span>
            <span className="text-sm font-semibold">{h.name}</span>
            <div className="flex gap-1">
              {h.example.map((c) => (
                <PlayingCard key={c} card={c} size="sm" />
              ))}
            </div>
          </div>
          <p className="mt-1.5 pl-9 text-xs leading-relaxed text-muted">{h.desc}</p>
        </div>
      ))}
    </div>
  );
}

export function CollapsibleHandRankings({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('space-y-2', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-muted hover:text-text"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        役一覧
      </button>
      {open && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface-2/60 p-3">
          <HandRankingsList />
        </div>
      )}
    </div>
  );
}
