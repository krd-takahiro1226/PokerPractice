import { evaluate7, handCategory, CATEGORY, CATEGORY_NAME } from '../../core/evaluator';
import { classifyStrength, type MadeClass, type DrawClass } from '../../core/ai/handStrength';
import { cardRank, type Card } from '../../core/cards';
import { cn } from '../../lib/cn';

type HandRankInfoProps = {
  hole: [Card, Card];
  board: Card[];
  className?: string;
};

const MADE_LABEL: Partial<Record<MadeClass, string>> = {
  'top-pair': 'トップペア',
  overpair: 'オーバーペア',
  'mid-pair': 'ミドルペア',
  'weak-pair': 'ウィークペア',
  'two-pair': 'ツーペア',
  set: 'セット',
  straight: 'ストレート',
  flush: 'フラッシュ',
  'full-plus': 'フルハウス以上',
  // air と trips(ボードペア由来のスリーカード) は categoryName 側で十分表現できるため表示しない
};

const DRAW_LABEL: Partial<Record<DrawClass, string>> = {
  'flush-draw': 'フラッシュドロー',
  oesd: 'ストレートドロー',
  gutshot: 'ガットショット',
  'combo-draw': 'コンボドロー',
  // none は表示しない
};

type StrengthTier = {
  label: string;
  textClass: string;
};

function strengthTier(score: number): StrengthTier {
  if (score < 0.25) return { label: '弱い', textClass: 'text-muted' };
  if (score < 0.5) return { label: 'やや弱い', textClass: 'text-muted' };
  if (score < 0.7) return { label: '普通', textClass: 'text-text' };
  if (score < 0.85) return { label: '強い', textClass: 'text-accent-bright' };
  return { label: 'とても強い', textClass: 'text-amber-300' };
}

export type HandRankSummary = {
  categoryName: string;
  detailLabel: string | null;
  score: number;
  strengthLabel: string;
  strengthTextClass: string;
  filledBars: number;
};

/** ホールカードとボードから「役名」「詳細ラベル」「強さ」を導出する純関数。 */
export function handRankSummary(hole: [Card, Card], board: Card[]): HandRankSummary {
  const { made, draw, score } = classifyStrength(hole, board);

  let categoryName: string;
  if (board.length >= 3) {
    const value = evaluate7([...hole, ...board]);
    const category = handCategory(value);
    // evaluate7 のエンコードは cat*16^5 + kicker0*16^4 + …。ストレートフラッシュの
    // kicker0 は最上位カードで、A(=12) ならロイヤル。
    const isRoyal =
      category === CATEGORY.STRAIGHT_FLUSH && Math.floor(value / 16 ** 4) % 16 === 12;
    categoryName = isRoyal ? 'ロイヤルストレートフラッシュ' : CATEGORY_NAME[category];
  } else {
    const isPocketPair = cardRank(hole[0]) === cardRank(hole[1]);
    categoryName = isPocketPair ? 'ワンペア' : 'ハイカード';
  }

  const madeLabel = MADE_LABEL[made];
  const dedupedMadeLabel = madeLabel && madeLabel !== categoryName ? madeLabel : null;
  const drawLabel = DRAW_LABEL[draw];
  const detailLabel = [dedupedMadeLabel, drawLabel].filter(Boolean).join(' / ') || null;

  const tier = strengthTier(score);
  const filledBars = Math.min(5, Math.max(1, Math.round(score * 5)));

  return {
    categoryName,
    detailLabel,
    score,
    strengthLabel: tier.label,
    strengthTextClass: tier.textClass,
    filledBars,
  };
}

/** 対戦中いつでも自分の現在の役とざっくりした強さを表示するバッジ。ヒーローのホールカードにのみ使用する。 */
export function HandRankInfo({ hole, board, className }: HandRankInfoProps) {
  const summary = handRankSummary(hole, board);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-surface-2/60 px-2.5 py-1.5 text-[11px]',
        className,
      )}
    >
      <span className="font-semibold text-text">{summary.categoryName}</span>
      {summary.detailLabel && <span className="text-muted">{summary.detailLabel}</span>}
      <span className="flex items-center gap-1.5">
        <span className="flex items-center gap-0.5">
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 w-4 rounded-full',
                i < summary.filledBars ? 'bg-accent' : 'bg-surface-2',
              )}
            />
          ))}
        </span>
        <span className={summary.strengthTextClass}>{summary.strengthLabel}</span>
      </span>
    </div>
  );
}
