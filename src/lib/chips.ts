export const CHIPS_PER_BB = 100;
export type ChipDisplay = 'bb' | 'chips';

export function formatAmount(bb: number, display: ChipDisplay): string {
  if (display === 'chips') return Math.round(bb * CHIPS_PER_BB).toLocaleString();
  return `${bb.toFixed(1)}bb`;
}
