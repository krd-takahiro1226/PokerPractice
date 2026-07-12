import { RANKS, SUITS, type Card } from '../../src/core/cards';
import { canonicalFlop } from '../../src/core/solver/types';

/** C(52,3) を canonicalFlop で同型除去した 1,755 種の flopIso 一覧（順不同）。 */
export function allCanonicalFlops(): string[] {
  const deck: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(`${r}${s}` as Card);

  const seen = new Set<string>();
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      for (let k = j + 1; k < deck.length; k++) {
        seen.add(canonicalFlop([deck[i], deck[j], deck[k]]));
      }
    }
  }
  return [...seen];
}

/** 同梱スターター6枚（生カード表記）。dry/wet・paired・connected を横断する代表テクスチャ。
 *  当初12枚の計画から縮小（直列ソルブの所要時間を同梱作業として現実的な範囲に収めるため）。
 *  残りのテクスチャとフル 1,755 枚は resume 可能バッチでユーザーが夜間実行する運用（README 参照）。 */
const STARTER_RAW: [Card, Card, Card][] = [
  ['Ah', 'Kd', '7c'], // A-hi ドライ（AK7r）
  ['Ah', '7d', '2c'], // A-hi 超ドライ（A72r）
  ['Qh', 'Jd', '2c'], // ブロードウェイ（QJ2r）
  ['Th', '9h', '8c'], // 連結ウェット（T98 two-tone）
  ['7h', '7d', '6c'], // ペアボード（776r）
  ['8h', '5d', '2c'], // ロー・ドライ（852r）
];

/** スターターDBとして同梱する flop（canonical 正規形）。 */
export const STARTER_FLOPS: string[] = STARTER_RAW.map(canonicalFlop);

/** flopIso（例 'AhKd7c'）を set_board 用の "Ah,Kd,7c" 表記に変換する。 */
export function flopIsoToBoardArg(flopIso: string): string {
  const cards = flopIso.match(/.{2}/g);
  if (!cards || cards.length !== 3) throw new Error(`invalid flopIso: ${flopIso}`);
  return cards.join(',');
}
