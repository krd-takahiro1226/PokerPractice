import { tokensToRangeWithActions } from './expand';
import type { Position, Range } from './types';

export type VsOpenScenario = {
  id: string;
  label: string;
  heroPos: Position;
  villainPos: Position;
  range: Range;
};

// BB vs BTN open: callレンジ広め、3betはプレミアム+ブラフ
const BB_vs_BTN = tokensToRangeWithActions({
  call: [
    '22-JJ',
    'ATo+', 'A9s+', 'A5s-A2s',
    'KJo+', 'KTs+', 'K9s',
    'QJo', 'QTs+', 'Q9s',
    'JTs', 'J9s',
    'T9s', 'T8s',
    '98s', '97s',
    '87s', '86s',
    '76s', '75s',
    '65s', '64s',
    '54s',
  ],
  raise: [
    'QQ+', 'AKs', 'AKo',
    'A5s', 'A4s',  // ブラフ3bet
    'K9s',          // ブラフ
  ],
});

// BB vs CO open
const BB_vs_CO = tokensToRangeWithActions({
  call: [
    '22-JJ',
    'AJo+', 'ATs+', 'A5s-A2s',
    'KQo', 'KJs+', 'KTs',
    'QJs', 'QTs',
    'JTs', 'J9s',
    'T9s', 'T8s',
    '98s', '97s',
    '87s',
    '76s',
    '65s',
    '54s',
  ],
  raise: [
    'QQ+', 'AKs', 'AKo',
    'A5s', 'A4s',
  ],
});

// SB vs BTN open
const SB_vs_BTN = tokensToRangeWithActions({
  call: [
    '22-JJ',
    'ATo+', 'A9s+', 'A5s-A3s',
    'KQo', 'KJs+', 'KTs',
    'QJs', 'QTs',
    'JTs',
    'T9s', 'T8s',
    '98s',
    '87s',
    '76s',
    '65s',
  ],
  raise: [
    'QQ+', 'AKs', 'AKo',
    'A5s', 'A4s',
    'K9s',
  ],
});

// BTN vs CO open (IP 3bet/call)
const BTN_vs_CO = tokensToRangeWithActions({
  call: [
    '22-TT',
    'AJo+', 'ATs+', 'A9s', 'A5s-A2s',
    'KQo', 'KJs+', 'KTs',
    'QJs', 'QTs', 'Q9s',
    'JTs', 'J9s',
    'T9s', 'T8s',
    '98s', '97s',
    '87s', '86s',
    '76s',
    '65s',
    '54s',
  ],
  raise: [
    'QQ+', 'AKs', 'AKo',
    'A5s', 'A4s',
    'KQs',
  ],
});

// BB vs UTG open（タイトめにコール）
const BB_vs_UTG = tokensToRangeWithActions({
  call: [
    '22-JJ',
    'AQo+', 'ATs+', 'A5s-A4s',
    'KQo', 'KQs', 'KJs',
    'QJs', 'QTs',
    'JTs',
    'T9s',
    '98s',
    '87s',
    '76s',
    '65s',
  ],
  raise: [
    'QQ+', 'AKs', 'AKo',
    'A5s',
  ],
});

export const VSOPEN_SCENARIOS: VsOpenScenario[] = [
  {
    id: 'vsBTN_fromBB',
    label: 'vs BTN open（あなたBB）',
    heroPos: 'BB',
    villainPos: 'BTN',
    range: BB_vs_BTN,
  },
  {
    id: 'vsCO_fromBB',
    label: 'vs CO open（あなたBB）',
    heroPos: 'BB',
    villainPos: 'CO',
    range: BB_vs_CO,
  },
  {
    id: 'vsBTN_fromSB',
    label: 'vs BTN open（あなたSB）',
    heroPos: 'SB',
    villainPos: 'BTN',
    range: SB_vs_BTN,
  },
  {
    id: 'vsCO_fromBTN',
    label: 'vs CO open（あなたBTN）',
    heroPos: 'BTN',
    villainPos: 'CO',
    range: BTN_vs_CO,
  },
  {
    id: 'vsUTG_fromBB',
    label: 'vs UTG open（あなたBB）',
    heroPos: 'BB',
    villainPos: 'UTG',
    range: BB_vs_UTG,
  },
];

export function getVsOpen(heroPos: Position, villainPos: Position): VsOpenScenario | undefined {
  return VSOPEN_SCENARIOS.find((s) => s.heroPos === heroPos && s.villainPos === villainPos);
}
