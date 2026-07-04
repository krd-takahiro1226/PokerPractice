import { useState } from 'react';
import { PlayingCard } from '../../components/PlayingCard';
import { Button } from '../../components/Button';
import { cn } from '../../lib/cn';
import type { Card } from '../../core/cards';

const HERO_CARDS: Card[] = ['As', 'Ks'];
const VILLAIN_CARDS: Card[] = ['Qd', 'Td'];

type StepData = {
  title: string;
  boardCount: number;
  showVillain: boolean;
  lines: string[];
};

const STEPS: StepData[] = [
  {
    title: 'ブラインドと配牌',
    boardCount: 0,
    showVillain: false,
    lines: [
      'SB は 0.5bb、BB は 1bb を強制的にベットします（ブラインド）。',
      'あなたは BTN（ボタン）に座り、A♠K♠ を配られました。他のプレイヤーは全員 fold し、あなたと BB の一騎打ちです。',
    ],
  },
  {
    title: 'プリフロップ',
    boardCount: 0,
    showVillain: false,
    lines: [
      'あなたの選択肢は fold / call / raise。A♠K♠ は強いハンドなので 2.5bb にオープン（そのハンドで最初のレイズをオープンと呼びます）します。',
      'BB はそのレイズに対してコールし、プリフロップのベットのラウンドが終了します。',
    ],
  },
  {
    title: 'フロップ',
    boardCount: 3,
    showVillain: false,
    lines: [
      'K♥ 7♦ 2♠ がボードに置かれました（フロップ）。あなたはボードの一番高いカードとのペア（トップペア）に加え、A キッカー（ペアにならなかった残りのカード。同じ役同士の勝負ではこの強さで決まります）を持つ強いハンドです。',
      'BB はチェックし、あなたはベット。BB はコールしてターンに進みます。',
    ],
  },
  {
    title: 'ターン',
    boardCount: 4,
    showVillain: false,
    lines: [
      'Q♣ が追加されました（ターン）。BB はこのカードでクイーンのペアが完成し、チェック → あなたのベットにコールという駆け引きが起こります。',
      'あなたはまだ K のトップペア + A キッカーでリードしているので、ベットを続けます。',
    ],
  },
  {
    title: 'リバー & ショーダウン',
    boardCount: 5,
    showVillain: true,
    lines: [
      '3♦ が追加され（リバー）、両者の最終手が出そろいました。ベットが応酬された後、ショーダウン（手札を公開して比較）になります。',
      'あなたは K♥K のペア + A キッカー、BB は Q♣Q のペア。あなたの手が上回り、ポットを獲得します。',
    ],
  },
];

const BOARD_CARDS: Card[] = ['Kh', '7d', '2s', 'Qc', '3d'];

export function ExampleHandWalkthrough() {
  const [step, setStep] = useState(0);
  const data = STEPS[step];

  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-tight">
          例題ハンド: {data.title}
        </h3>
        <div className="flex items-center gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-2 w-2 rounded-full transition',
                i === step ? 'bg-accent-bright' : 'bg-border-bright',
              )}
            />
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {/* Hero hand */}
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted">
            あなたの手札（BTN）
          </div>
          <div className="flex gap-1.5">
            {HERO_CARDS.map((c) => (
              <PlayingCard key={c} card={c} size="sm" />
            ))}
          </div>
        </div>

        {/* Board */}
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted">
            ボード
          </div>
          <div className="flex gap-1.5">
            {data.boardCount === 0 ? (
              <span className="text-sm text-muted">（まだ何も出ていません）</span>
            ) : (
              BOARD_CARDS.slice(0, data.boardCount).map((c, i) => (
                <PlayingCard key={`${c}-${i}`} card={c} size="sm" />
              ))
            )}
          </div>
        </div>

        {/* Villain hand (revealed at showdown) */}
        {data.showVillain && (
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted">
              BB の手札（ショーダウンで公開）
            </div>
            <div className="flex gap-1.5">
              {VILLAIN_CARDS.map((c) => (
                <PlayingCard key={c} card={c} size="sm" />
              ))}
            </div>
          </div>
        )}

        {/* Explanation */}
        <div className="space-y-1.5 rounded-lg bg-surface/50 p-3 text-sm leading-relaxed text-text">
          {data.lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="mt-4 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          ← 前へ
        </Button>
        <span className="text-xs text-muted">
          {step + 1} / {STEPS.length}
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          disabled={step === STEPS.length - 1}
        >
          次へ →
        </Button>
      </div>
    </div>
  );
}
