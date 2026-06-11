import type { HandClass } from '../handNotation';

/** tier1 紺「8人(強)」 */
export const TIER1: HandClass[] = ['AA', 'KK', 'QQ', 'AKs', 'AKo'];

/** tier2 赤「8人(中)」 */
export const TIER2: HandClass[] = ['JJ', 'TT', '99', 'AQs', 'AJs', 'ATs', 'KQs', 'AQo'];

/** tier3 黄「8人(弱)」 */
export const TIER3: HandClass[] = [
  '88', '77', 'KJs', 'QJs', 'JTs', 'AJo', 'KQo',
];

/** tier4 緑「6〜7人」 */
export const TIER4: HandClass[] = [
  '66', '55',
  'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
  'KTs', 'K9s', 'QTs', 'T9s', 'ATo', 'KJo',
];

/** tier5 青「4〜5人」 */
export const TIER5: HandClass[] = [
  '44', '33', '22',
  'Q9s', 'J9s', 'T8s', '98s',
  'A9o', 'KTo', 'QJo', 'JTo',
];

/** tier6 白「3人」 */
export const TIER6: HandClass[] = [
  'K8s', 'K7s', 'K6s', 'K5s', 'K4s', 'K3s', 'K2s',
  'Q8s', 'Q7s', 'Q6s', 'J8s', 'J7s', '97s', '87s', '76s', '65s',
  'QTo', 'K9o', 'Q9o', 'J9o', 'T9o', 'A8o', 'A7o',
];

/** tier7 紫「2人」 */
export const TIER7: HandClass[] = [
  'Q5s', 'Q4s', 'Q3s', 'Q2s', 'J6s', 'T7s', '96s', '86s', '75s', '64s', '54s',
  'A6o', '98o',
];

/** bbCall ピンク「BBのみBTNのレイズにコール」。オープンには使わない。 */
export const BB_CALL: HandClass[] = [
  'J5s', 'J4s', 'J3s', 'J2s', 'T6s', 'T5s', 'T4s', 'T3s', '95s', '85s', '74s', '63s', '53s', '43s',
  'A5o', 'A4o', 'A3o', 'A2o',
  'K8o', 'K7o', 'K6o', 'K5o', 'Q8o', 'Q7o', 'J8o', 'T8o', '97o', '87o',
];

/** tier 配列（index 0 = tier1）。累積スライスで使う。 */
export const TIERS: HandClass[][] = [TIER1, TIER2, TIER3, TIER4, TIER5, TIER6, TIER7];
