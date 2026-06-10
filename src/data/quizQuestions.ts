import type { HandClass } from '../core/handNotation';
import type { Position } from '../core/ranges/types';

export type QuizQuestion = {
  id: string;
  prompt: string;
  context?: { heroPos?: Position; hand?: HandClass };
  choices: { label: string; value: string }[];
  answer: string;
  explanation: string;
};

const OPEN_CHOICES = [
  { label: 'フォールド', value: 'fold' },
  { label: 'オープン (レイズ)', value: 'raise' },
];

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'pf-utg-ajo',
    prompt: 'UTG（アンダー・ザ・ガン）にAJoが配られた。フォールドされてあなたが最初のアクション。',
    context: { heroPos: 'UTG', hand: 'AJo' },
    choices: OPEN_CHOICES,
    answer: 'raise',
    explanation: 'UTGはタイトに開くべきポジションだが、AJoは十分に強い標準的なオープンハンド。',
  },
  {
    id: 'pf-utg-a9o',
    prompt: 'UTGにA9oが配られた。最初のアクションはどうする？',
    context: { heroPos: 'UTG', hand: 'A9o' },
    choices: OPEN_CHOICES,
    answer: 'fold',
    explanation: 'A9oはUTGのオープンレンジ外。後ろに5人残っているため、弱いエースオフスートはフォールドが基本。',
  },
  {
    id: 'pf-hj-55',
    prompt: 'HJ（ハイジャック）に55。フォールドが回ってきた。',
    context: { heroPos: 'HJ', hand: '55' },
    choices: OPEN_CHOICES,
    answer: 'raise',
    explanation: 'すべてのポケットペアはセットの可能性とプレイアビリティを持つ。HJからは問題なくオープン。',
  },
  {
    id: 'pf-co-k8s',
    prompt: 'CO（カットオフ）にK8s。あなたが最初に開けるか？',
    context: { heroPos: 'CO', hand: 'K8s' },
    choices: OPEN_CHOICES,
    answer: 'fold',
    explanation: 'COのスーテッドKxはK9s以上が目安。K8sはやや弱く、標準レンジ外。',
  },
  {
    id: 'pf-co-54s',
    prompt: 'COに54s。フォールドが回ってきた。',
    context: { heroPos: 'CO', hand: '54s' },
    choices: OPEN_CHOICES,
    answer: 'raise',
    explanation: '54sはストレートとフラッシュの両方を狙えるプレイアビリティの高いハンド。COからはオープン。',
  },
  {
    id: 'pf-btn-75s',
    prompt: 'BTN（ボタン）に75s。あなたが最初のアクション。',
    context: { heroPos: 'BTN', hand: '75s' },
    choices: OPEN_CHOICES,
    answer: 'raise',
    explanation: 'BTNは最も広く開けられるポジション。スーテッドの75sは標準的なオープンハンド。',
  },
  {
    id: 'pf-btn-q9o',
    prompt: 'BTNにQ9o。フォールドが回ってきた。',
    context: { heroPos: 'BTN', hand: 'Q9o' },
    choices: OPEN_CHOICES,
    answer: 'raise',
    explanation: 'BTNは広いレンジで開ける。Q9oもオープンレンジに含まれる。',
  },
  {
    id: 'pf-sb-j9o',
    prompt: 'SB（スモールブラインド）にJ9o。BTNまでフォールド、あなたの番。',
    context: { heroPos: 'SB', hand: 'J9o' },
    choices: OPEN_CHOICES,
    answer: 'fold',
    explanation: 'SBのオフスートはJTo以上が目安。J9oはレンジ外でフォールド（BBと毎回戦う不利もある）。',
  },
  {
    id: 'concept-widest',
    prompt: 'プリフロップで最も広いレンジでオープンできるポジションは？',
    choices: [
      { label: 'UTG', value: 'UTG' },
      { label: 'CO', value: 'CO' },
      { label: 'BTN', value: 'BTN' },
      { label: 'SB', value: 'SB' },
    ],
    answer: 'BTN',
    explanation: 'BTNはポストフロップで常に最後に行動できる（ポジションが最も有利）ため、最も広く開けられる。',
  },
  {
    id: 'concept-tightest',
    prompt: '最もタイト（強いハンドに絞って）にオープンすべきポジションは？',
    choices: [
      { label: 'UTG', value: 'UTG' },
      { label: 'HJ', value: 'HJ' },
      { label: 'CO', value: 'CO' },
      { label: 'BTN', value: 'BTN' },
    ],
    answer: 'UTG',
    explanation: 'UTGは後ろに最も多くのプレイヤーが残っているため、強いハンドに絞る必要がある。',
  },
];
