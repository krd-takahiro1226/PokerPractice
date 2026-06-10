import { tokensToRange } from './expand';
import type { Scenario } from './types';

/**
 * RFI (Raise First In) starter ranges — NLH 6-max 100bb.
 * Simplified / approximate, pure-raise. Tune against a reference chart before shipping.
 * See docs/DESIGN.md §6.
 */

const UTG = [
  '22+',
  'ATs+', 'A5s-A4s', 'KTs+', 'QTs+', 'JTs', 'T9s', '98s', '87s', '76s',
  'AJo+', 'KQo',
];

const HJ = [
  '22+',
  'A9s+', 'A5s-A4s', 'K9s+', 'Q9s+', 'J9s+', 'T8s+', '98s', '87s', '76s', '65s',
  'ATo+', 'KJo+', 'QJo',
];

const CO = [
  '22+',
  'A2s+', 'K9s+', 'Q9s+', 'J9s+', 'T8s+', '97s+', '86s+', '76s', '65s', '54s',
  'A9o+', 'KTo+', 'QTo+', 'JTo',
];

const BTN = [
  '22+',
  'A2s+', 'K5s+', 'Q8s+', 'J8s+', 'T8s+', '97s+', '86s+', '75s+', '64s+', '54s', '43s',
  'A2o+', 'K9o+', 'Q9o+', 'J9o+', 'T9o', '98o',
];

const SB = [
  '22+',
  'A2s+', 'K7s+', 'Q8s+', 'J8s+', 'T8s+', '97s+', '86s+', '75s+', '65s', '54s',
  'A7o+', 'K9o+', 'QTo+', 'JTo',
];

export const RFI_SCENARIOS: Scenario[] = [
  { id: 'RFI_UTG', label: 'UTG オープン', heroPos: 'UTG', context: 'RFI', sizeBB: 2.5, range: tokensToRange(UTG) },
  { id: 'RFI_HJ', label: 'HJ オープン', heroPos: 'HJ', context: 'RFI', sizeBB: 2.5, range: tokensToRange(HJ) },
  { id: 'RFI_CO', label: 'CO オープン', heroPos: 'CO', context: 'RFI', sizeBB: 2.5, range: tokensToRange(CO) },
  { id: 'RFI_BTN', label: 'BTN オープン', heroPos: 'BTN', context: 'RFI', sizeBB: 2.5, range: tokensToRange(BTN) },
  { id: 'RFI_SB', label: 'SB オープン', heroPos: 'SB', context: 'RFI', sizeBB: 3.0, range: tokensToRange(SB) },
];
