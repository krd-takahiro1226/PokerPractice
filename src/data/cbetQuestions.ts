import type { Card } from '../core/cards';
import type { Position } from '../core/ranges/types';

/** CB戦略の3択。 */
export type CbetStrategy = 'high' | 'mixed' | 'check';

/** フロップのテクスチャ分類タグ（複数付与可）。 */
export type FlopTexture =
  | 'A-high'
  | 'K-high'
  | 'broadway'
  | 'middle-connected'
  | 'low-connected'
  | 'low-board'
  | 'paired'
  | 'monotone'
  | 'two-tone'
  | 'rainbow'
  | 'wet'
  | 'dry';

export type CbetScenario = {
  id: string;
  label: string;
  openerPos: Position;
  callerPos: Position;
};

export type CbetQuestion = {
  id: string;
  scenarioId: string;
  board: [Card, Card, Card];
  textures: FlopTexture[];
  answer: CbetStrategy;
  explanation: string;
};

export const CBET_SCENARIOS: CbetScenario[] = [
  { id: 'BTN_vs_BB', label: 'BTN open vs BB call', openerPos: 'BTN', callerPos: 'BB' },
];

export const CBET_QUESTIONS: CbetQuestion[] = [
  // ── A-high dry ──────────────────────────────────────────────────────────────
  {
    id: 'cb-btnbb-A72r',
    scenarioId: 'BTN_vs_BB',
    board: ['As', '7d', '2c'],
    textures: ['A-high', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BTNはAx（AT〜A2s含む）をレンジに多く持ち、トップペア以上のナッツ級が大幅にBTN有利。BBはA72に刺さりにくいため、小サイズのレンジベットが最も効率的。',
  },
  {
    id: 'cb-btnbb-AK4r',
    scenarioId: 'BTN_vs_BB',
    board: ['Ah', 'Kd', '4c'],
    textures: ['A-high', 'broadway', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BTNはAx・Kxを豊富に持ちナッツ級が圧倒的にBTN寄り。BBがAKを持つ確率はBTNより低く、このボードでBTNのレンジ有利は明確。高頻度CB（レンジベット）が適切。',
  },
  {
    id: 'cb-btnbb-A83r',
    scenarioId: 'BTN_vs_BB',
    board: ['Ac', '8h', '3d'],
    textures: ['A-high', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BTNのAxポーカーハンドがトップペア以上を多く形成する。BB側はA8やA3のスーテッドのみだが少なく、BTNのナッツ級有利が顕著。レンジベット気味で高頻度CBが有効。',
  },
  {
    id: 'cb-btnbb-A52r',
    scenarioId: 'BTN_vs_BB',
    board: ['Ad', '5h', '2s'],
    textures: ['A-high', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'Aハイの超ドライボード。BTNのAxハンドが多くトップペア以上を保持し、BBのコールレンジにはフロップに刺さるハンドが少ない。BTNのナッツ級が圧倒的に多く高頻度CBが最善。',
  },
  {
    id: 'cb-btnbb-A94r',
    scenarioId: 'BTN_vs_BB',
    board: ['As', '9d', '4c'],
    textures: ['A-high', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BTNはA9s・A4s・A9o等のナッツ級を持ち、BBには同様の強いAxが少ない。ドライなレインボーボードでBTNのレンジ有利が最大限に発揮され、小サイズの高頻度CBが機能する。',
  },
  {
    id: 'cb-btnbb-A62s-tt',
    scenarioId: 'BTN_vs_BB',
    board: ['As', '6s', '2h'],
    textures: ['A-high', 'two-tone', 'dry'],
    answer: 'high',
    explanation:
      'BTNはAx（ナッツ）を圧倒的に多く持ち、フラッシュドローはBBにもあるが本質的なナッツ級はBTN寄り。ツートーンだが依然としてBTN有利の構造でCB頻度は高い。',
  },

  // ── K-high dry ──────────────────────────────────────────────────────────────
  {
    id: 'cb-btnbb-K72r',
    scenarioId: 'BTN_vs_BB',
    board: ['Ks', '7d', '2c'],
    textures: ['K-high', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BTNはKxハンドを多く持ち（KQ〜K2s）、このドライボードでトップペア以上のナッツ級がBTN有利。BBのコールレンジには7xや2xが少なく、小サイズのレンジベットが高効率。',
  },
  {
    id: 'cb-btnbb-KQ5r',
    scenarioId: 'BTN_vs_BB',
    board: ['Kd', 'Qh', '5c'],
    textures: ['K-high', 'broadway', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BTNはKQ（2ペア）・KT+・Q+の強いブロードウェイハンドを多く持ち、ナッツ級がBTN有利。BBもKQスーテッドを持つが枚数で劣る。ドライなため高頻度CBが有効。',
  },
  {
    id: 'cb-btnbb-K82r',
    scenarioId: 'BTN_vs_BB',
    board: ['Kc', '8s', '2d'],
    textures: ['K-high', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'KハイのドライボードでBTNのKxが多いため、ナッツ級はBTNに偏っている。BBのコールレンジは小ペアや中程度のスーコネが主で、K82に刺さりにくい。高頻度CBが正当化される。',
  },
  {
    id: 'cb-btnbb-KJ3r',
    scenarioId: 'BTN_vs_BB',
    board: ['Kh', 'Jd', '3s'],
    textures: ['K-high', 'broadway', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BTNはKJ（2ペア）・KT+・JT等の強いブロードウェイを多く持つ。BBもKJ・JT等を持つがBTNに比べ枚数で劣り、ナッツ級はBTN有利。レインボードライでCB頻度は高い。',
  },
  {
    id: 'cb-btnbb-K53r',
    scenarioId: 'BTN_vs_BB',
    board: ['Ks', '5d', '3h'],
    textures: ['K-high', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BTNのKxがナッツ構造を支配し、BBのコールレンジは54s・53sのような小スーコネが主。このボードへの刺さり具合はBTNが圧倒的で、高頻度CBが最も効率的。',
  },
  {
    id: 'cb-btnbb-K74tt',
    scenarioId: 'BTN_vs_BB',
    board: ['Kh', '7h', '4d'],
    textures: ['K-high', 'two-tone', 'dry'],
    answer: 'mixed',
    explanation:
      'KハイツートーンでBTNのKxはナッツ優位だが、フラッシュドローがBBのコールレンジに存在する。KハイドライのナッツはBTN有利だが、フラッシュドロー考慮でCB頻度はミックス程度が適切。',
  },

  // ── Broadway dry / mixed ───────────────────────────────────────────────────
  {
    id: 'cb-btnbb-QJ4r',
    scenarioId: 'BTN_vs_BB',
    board: ['Qd', 'Jc', '4h'],
    textures: ['broadway', 'rainbow', 'dry'],
    answer: 'mixed',
    explanation:
      'BTNはQJ・KQ・KJ等を多く持つが、BBもQJ・JT・QT等のブロードウェイコールレンジを持ちエクイティが接近する。ナッツ級はBTN有利だがやや拮抗しており、ミックス戦略が適切。',
  },
  {
    id: 'cb-btnbb-QT6r',
    scenarioId: 'BTN_vs_BB',
    board: ['Qh', 'Td', '6c'],
    textures: ['broadway', 'rainbow', 'dry'],
    answer: 'mixed',
    explanation:
      'QTはBTNのブロードウェイ優位が残るが、BBのJT・QT・T9sがフロップに刺さる。ナッツ（AQやQQ等）はBTN有利だが、BBのドロー可能性も考慮してミックス戦略が合理的。',
  },
  {
    id: 'cb-btnbb-JT5r',
    scenarioId: 'BTN_vs_BB',
    board: ['Jc', 'Th', '5d'],
    textures: ['broadway', 'rainbow', 'dry'],
    answer: 'mixed',
    explanation:
      'JTはBTNのオーバーペア・トップペア優位があるが、BBのJT・T9s・QJ等がボードにヒットする。両者がナッツ級を保有する可能性があり、ミックス戦略でポーカーレンジを守る。',
  },
  {
    id: 'cb-btnbb-Q74r',
    scenarioId: 'BTN_vs_BB',
    board: ['Qs', '7h', '4c'],
    textures: ['broadway', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BTNのQxが多くナッツ（QQ・AQ等）がBTN有利。7や4にはBBのスーコネが刺さるが、メインのナッツ構造はBTN寄り。Q74はQJやKQより低位の連結が弱く高頻度CBが有効。',
  },
  {
    id: 'cb-btnbb-KT8r',
    scenarioId: 'BTN_vs_BB',
    board: ['Kd', 'Tc', '8h'],
    textures: ['broadway', 'middle-connected', 'rainbow'],
    answer: 'mixed',
    explanation:
      'KTはBTNのKx・Tx優位があるが、BBのKT・T9s・JT等がフロップに刺さりエクイティが接近する。ストレートドロー（QJ・J9等）も豊富でナッツ分布が完全にはBTN有利でなく、ミックスが適切。',
  },

  // ── Middle connected (mixed / check) ────────────────────────────────────────
  {
    id: 'cb-btnbb-987r',
    scenarioId: 'BTN_vs_BB',
    board: ['9s', '8d', '7h'],
    textures: ['middle-connected', 'rainbow', 'wet'],
    answer: 'check',
    explanation:
      'BBのコールレンジ（65s・76s・T9s等）がこのミドル連結ボードに多くヒットする。BTNのオーバーペア（AA〜TT）はあるが、ナッツ（スーパーストレート）はBB有利。チェックでレンジを守るべき。',
  },
  {
    id: 'cb-btnbb-T98tt',
    scenarioId: 'BTN_vs_BB',
    board: ['Th', '9h', '8d'],
    textures: ['middle-connected', 'two-tone', 'wet'],
    answer: 'check',
    explanation:
      'ツートーンのミドル連結ボードはBBのスーコネ（76s・87s・JTs等）が多くヒットし、ナッツ（ストレート）がBB有利。フラッシュドローまで加わりBTNのCBは非効率。チェックが無難。',
  },
  {
    id: 'cb-btnbb-J98r',
    scenarioId: 'BTN_vs_BB',
    board: ['Jd', '9c', '8s'],
    textures: ['middle-connected', 'rainbow', 'wet'],
    answer: 'mixed',
    explanation:
      'BTNのJx・オーバーペアはあるが、BBのT7s・QT等がストレートドローを形成する。ナッツ（QT・T7等のストレート）は拮抗〜BB有利。BTNのトップペア優位は残るが頻度はミックスが適切。',
  },
  {
    id: 'cb-btnbb-876tt',
    scenarioId: 'BTN_vs_BB',
    board: ['8c', '7c', '6s'],
    textures: ['middle-connected', 'two-tone', 'wet'],
    answer: 'check',
    explanation:
      'BBのコールレンジ（54s・95s・T9s等）がこのミドル〜ロー連結ボードにストレート/ツーペアとして刺さる。ナッツ分布がBB寄りで、フラッシュドローも交錯。チェックでレンジバランスを保つ。',
  },
  {
    id: 'cb-btnbb-JT9tt',
    scenarioId: 'BTN_vs_BB',
    board: ['Js', 'Ts', '9d'],
    textures: ['middle-connected', 'two-tone', 'wet'],
    answer: 'check',
    explanation:
      'ハイカード連結ツートーンはBBのQTs・KTs・87s等が多くヒット。ナッツ（QK・KQ等のストレート）と上位ツーペアが拮抗。BTNのレンジ有利が縮み、CBは頻度を下げてチェック多めが適切。',
  },
  {
    id: 'cb-btnbb-T87r',
    scenarioId: 'BTN_vs_BB',
    board: ['Td', '8s', '7c'],
    textures: ['middle-connected', 'rainbow', 'wet'],
    answer: 'mixed',
    explanation:
      'BTNのTxとオーバーペアはあるが、BBの96s・J9s・65s等がヒットする。ナッツは拮抗気味。BTNのトップペア優位でミックス戦略（一部CBと一部チェック）が最善。',
  },

  // ── Low connected (check) ────────────────────────────────────────────────────
  {
    id: 'cb-btnbb-654r',
    scenarioId: 'BTN_vs_BB',
    board: ['6s', '5d', '4c'],
    textures: ['low-connected', 'rainbow', 'wet'],
    answer: 'check',
    explanation:
      'BBのコールレンジ（54s・65s・76s・32s等）がこのロー連結ボードに多くヒットする。ナッツ（7や8のストレート）はBB有利。BTNのオーバーカードはあるが、ナッツ級分布がBB寄りのためチェックが基本。',
  },
  {
    id: 'cb-btnbb-765tt',
    scenarioId: 'BTN_vs_BB',
    board: ['7h', '6h', '5d'],
    textures: ['low-connected', 'two-tone', 'wet'],
    answer: 'check',
    explanation:
      'BBが65s・54s・87s・43sのようなスーコネでナッツストレート・フラッシュドローを多く保有する典型的なBB有利ボード。BTNのCBは非効率でチェックが最善。',
  },
  {
    id: 'cb-btnbb-543r',
    scenarioId: 'BTN_vs_BB',
    board: ['5c', '4d', '3h'],
    textures: ['low-connected', 'rainbow', 'wet'],
    answer: 'check',
    explanation:
      'BBの32s・65s・A2s等がストレート/ツーペアを形成しナッツ級がBB有利。BTNのオーバーカードは強みだがナッツ分布が悪く、このローボードでCBを続けることは不利益。',
  },
  {
    id: 'cb-btnbb-876r',
    scenarioId: 'BTN_vs_BB',
    board: ['8d', '7s', '6h'],
    textures: ['low-connected', 'rainbow', 'wet'],
    answer: 'check',
    explanation:
      '876はBBのT9s・54s・65s等がストレート/ツーペアでナッツ級に到達しやすいボード。BBのコールレンジにとって有利で、BTNは高頻度CBを打つと搾取される。チェックが推奨。',
  },
  {
    id: 'cb-btnbb-753r',
    scenarioId: 'BTN_vs_BB',
    board: ['7c', '5s', '3d'],
    textures: ['low-connected', 'rainbow'],
    answer: 'check',
    explanation:
      'BTNのオーバーカードはあるが、46s・64s・A4s等のBBのコールレンジが42・64でストレートドローを持ちやすく、ナッツ級はBB有利〜拮抗。CBはコスト高でチェックが良い。',
  },

  // ── Low board dry (high) ─────────────────────────────────────────────────────
  {
    id: 'cb-btnbb-832r',
    scenarioId: 'BTN_vs_BB',
    board: ['8s', '3d', '2c'],
    textures: ['low-board', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'ローカードがバラついたドライボード。ナッツ（セット等）は少なく両者にとって刺さりにくいが、BTNのオーバーカードと強いハンドがレンジ有利を形成。小サイズのレンジベットが機能する。',
  },
  {
    id: 'cb-btnbb-742r',
    scenarioId: 'BTN_vs_BB',
    board: ['7d', '4h', '2s'],
    textures: ['low-board', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BTNのレンジ全体がこのローバラつきボードでオーバーカード優位を形成。BBのコールレンジは74s等が一部刺さるが少なく、ナッツ（セット・ツーペア）は少ない。BTNが小サイズで広くCBできる。',
  },
  {
    id: 'cb-btnbb-962r',
    scenarioId: 'BTN_vs_BB',
    board: ['9c', '6s', '2h'],
    textures: ['low-board', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'ナッツ級は少なく両者にとって強いハンドが刺さりにくいボード。BTNのレンジはAx・Kx・Qx等のオーバーカードで優位にあり、小サイズのレンジベットが効率的。',
  },
  {
    id: 'cb-btnbb-852r',
    scenarioId: 'BTN_vs_BB',
    board: ['8h', '5d', '2c'],
    textures: ['low-board', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BBのコールレンジは65s・54s等が一部ヒットするが、852のドライなバラつきボードでは連結が弱くナッツ到達が少ない。BTNのオーバーカード優位で高頻度CBが機能する。',
  },

  // ── Paired board (high) ──────────────────────────────────────────────────────
  {
    id: 'cb-btnbb-KK4r',
    scenarioId: 'BTN_vs_BB',
    board: ['Kd', 'Kh', '4c'],
    textures: ['paired', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'KKペアボードはKKを持つ確率が低く、両者ほぼ対等にトリップス到達が難しい。BTNのKx（KQ・KJ等）がキッカー有利なトリップスを持ちやすく、ナッツ傾向はBTN有利。高頻度CBが適切。',
  },
  {
    id: 'cb-btnbb-772r',
    scenarioId: 'BTN_vs_BB',
    board: ['7s', '7d', '2c'],
    textures: ['paired', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      '77ペアボードは両者ともトリップスへの到達率が低い。BTNのオーバーカード（AA・KK・QQ等）がキッカー有利のため、ペアボードでのBTNのレンジ有利が生きる。高頻度CBが機能。',
  },
  {
    id: 'cb-btnbb-QQ8r',
    scenarioId: 'BTN_vs_BB',
    board: ['Qc', 'Qh', '8d'],
    textures: ['paired', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'QQペアボードはBTNのKK・AA・AQ等が優位のキッカーを持ちやすく、ナッツ級がBTN有利。BBのQxコール比率はBTNより少なく、高頻度CBが搾取されにくい。',
  },
  {
    id: 'cb-btnbb-JJ6r',
    scenarioId: 'BTN_vs_BB',
    board: ['Js', 'Jc', '6h'],
    textures: ['paired', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'JJペアボードでBTNのAA・KK・QQ・AJ等がキッカー優位のトリップスになりやすく、ナッツ級はBTN有利。BBのJxも一部あるがBTNのほうが強いハンドを多く持つ。高頻度CBが有効。',
  },
  {
    id: 'cb-btnbb-AA9r',
    scenarioId: 'BTN_vs_BB',
    board: ['Ah', 'As', '9c'],
    textures: ['paired', 'A-high', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'AAペアボードは両者Axの確率は低いが、BTNのAx（AQ・AK等）がキッカー有利のトリップスを形成しやすい。ナッツ分布はBTN有利で高頻度CBが有効。',
  },
  {
    id: 'cb-btnbb-336r',
    scenarioId: 'BTN_vs_BB',
    board: ['3s', '3d', '6c'],
    textures: ['paired', 'low-board', 'rainbow'],
    answer: 'mixed',
    explanation:
      'ローペアボード（33x）はBBの64s・A3s等がフロップに刺さる可能性もある。33のトリップスは両者に均等で、6はBBのコールレンジに刺さりやすい。ローペアボードはミックスが適切。',
  },

  // ── Monotone (check / mixed) ─────────────────────────────────────────────────
  {
    id: 'cb-btnbb-K72m',
    scenarioId: 'BTN_vs_BB',
    board: ['Ks', '7s', '2s'],
    textures: ['K-high', 'monotone', 'wet'],
    answer: 'check',
    explanation:
      'モノトーンボードはフラッシュが完成しており、BBのスーテッドハンドのうち3枚スペードを持つものがナッツを保有する。BTNのKハイ有利は残るが、フラッシュ構造が交錯しCBは非効率。チェック多め。',
  },
  {
    id: 'cb-btnbb-T86m',
    scenarioId: 'BTN_vs_BB',
    board: ['Th', '8h', '6h'],
    textures: ['middle-connected', 'monotone', 'wet'],
    answer: 'check',
    explanation:
      'ミドル連結モノトーンはBBのスーテッドコネクターがフラッシュ+ストレートドローを持ちやすく、ナッツ構造がBB有利。BTNのCBは不利益でチェックが最善。',
  },
  {
    id: 'cb-btnbb-987m',
    scenarioId: 'BTN_vs_BB',
    board: ['9d', '8d', '7d'],
    textures: ['middle-connected', 'monotone', 'wet'],
    answer: 'check',
    explanation:
      'モノトーンのミドル連結は最もBTNにとってCBが難しいボードの一つ。ナッツフラッシュとストレートの両方がBBのレンジに多く、BTNのCBは搾取されやすい。チェックが支配的。',
  },
  {
    id: 'cb-btnbb-A64m',
    scenarioId: 'BTN_vs_BB',
    board: ['Ac', '6c', '4c'],
    textures: ['A-high', 'monotone', 'wet'],
    answer: 'mixed',
    explanation:
      'AハイモノトーンはBTNのAcフラッシュ（ナッツ）が存在するが、BBもスーテッドクラブを持ちフラッシュを保有する。BTNのAハイ有利は残るが、フラッシュ構造でCB頻度はミックス程度が適切。',
  },

  // ── Two-tone, various ────────────────────────────────────────────────────────
  {
    id: 'cb-btnbb-A72tt',
    scenarioId: 'BTN_vs_BB',
    board: ['Ah', '7h', '2c'],
    textures: ['A-high', 'two-tone', 'dry'],
    answer: 'high',
    explanation:
      'ツートーンだがAハイドライ構造でBTNのAxが圧倒的ナッツ優位。フラッシュドロー存在はCB頻度を若干下げるが、基本的にBTNのレンジ有利は維持される。高頻度CB（やや小サイズ）が適切。',
  },
  {
    id: 'cb-btnbb-K82tt',
    scenarioId: 'BTN_vs_BB',
    board: ['Kd', '8d', '2c'],
    textures: ['K-high', 'two-tone', 'dry'],
    answer: 'high',
    explanation:
      'KハイツートーンでもBTNのKxナッツ優位は明確。フラッシュドローはBBにもあるがナッツ（Kx）の有利は変わらない。若干CB頻度を抑えつつも高頻度CBが適切。',
  },
  {
    id: 'cb-btnbb-QT6tt',
    scenarioId: 'BTN_vs_BB',
    board: ['Qd', 'Td', '6h'],
    textures: ['broadway', 'two-tone', 'wet'],
    answer: 'mixed',
    explanation:
      'ツートーンのQT6はフラッシュドローとストレートドロー（KJ・J9）が豊富。BBのJTs・QTs等がドローを多く持ち、ナッツ分布が拮抗〜BB有利方向。CB頻度はミックス程度が適切。',
  },
  {
    id: 'cb-btnbb-987tt',
    scenarioId: 'BTN_vs_BB',
    board: ['9s', '8s', '7c'],
    textures: ['middle-connected', 'two-tone', 'wet'],
    answer: 'check',
    explanation:
      'ツートーンのミドル連結はBBのスーコネ（T6s・JTs・65s等）がストレート+フラッシュドローを保有。ナッツ分布がBB有利で、BTNのCBは高コスト。チェックが支配的。',
  },
  {
    id: 'cb-btnbb-654tt',
    scenarioId: 'BTN_vs_BB',
    board: ['6h', '5h', '4c'],
    textures: ['low-connected', 'two-tone', 'wet'],
    answer: 'check',
    explanation:
      'ロー連結ツートーンはBBのA3s・78s・87s等がストレート/フラッシュドローを豊富に持つ。ナッツ構造がBB有利で、BTNの高頻度CBは非推奨。チェックでレンジを守る。',
  },
  {
    id: 'cb-btnbb-T54tt',
    scenarioId: 'BTN_vs_BB',
    board: ['Tc', '5c', '4h'],
    textures: ['middle-connected', 'two-tone', 'wet'],
    answer: 'check',
    explanation:
      'BTNのTxはあるが、BBの65s・76s・A3s・A2s等がストレート/フラッシュドローを持つ。ミドル〜ローの連結ツートーンでナッツ分布がBB有利〜拮抗。チェック多めが適切。',
  },

  // ── Additional high CB scenarios ─────────────────────────────────────────────
  {
    id: 'cb-btnbb-AQ2r',
    scenarioId: 'BTN_vs_BB',
    board: ['Ac', 'Qd', '2h'],
    textures: ['A-high', 'broadway', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BTNはAx・Qxを豊富に持ちナッツ（AQ等）が多い。BBのコールレンジはこのボードにヒットしにくく、AQ2ドライでBTNのレンジ有利は明確。高頻度CBが最適。',
  },
  {
    id: 'cb-btnbb-KT2r',
    scenarioId: 'BTN_vs_BB',
    board: ['Ks', 'Td', '2c'],
    textures: ['K-high', 'broadway', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BTNのKxとTxがナッツ構造を支配。BBのJTs・T9s等が一部刺さるが、KT2ドライレインボーでBTNのナッツ有利は明確。高頻度CBが機能する。',
  },
  {
    id: 'cb-btnbb-A34r',
    scenarioId: 'BTN_vs_BB',
    board: ['As', '3d', '4c'],
    textures: ['A-high', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BTNのAxハンド（AK〜A2s）がトップペア以上を多く形成し、ナッツ級がBTN有利。BBのA3s・A4s等は一部刺さるがBTNに比べ少なく、高頻度CBが有効。',
  },
  {
    id: 'cb-btnbb-962tt',
    scenarioId: 'BTN_vs_BB',
    board: ['9s', '6s', '2h'],
    textures: ['low-board', 'two-tone'],
    answer: 'high',
    explanation:
      'BBのスーテッドコネクターがフラッシュドローを持つが、962のローバラつきボードでBTNのオーバーカード優位は維持される。ツートーンだが基本的に高頻度CBが適切。',
  },
  {
    id: 'cb-btnbb-843r',
    scenarioId: 'BTN_vs_BB',
    board: ['8d', '4s', '3c'],
    textures: ['low-board', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BTNのレンジ全体がオーバーカードでこのローバラつきボードを支配。BBのA2s・65s等が一部刺さるが少なく、ナッツ（セット）は稀。BTNが小サイズで広くCBできるボード。',
  },
  {
    id: 'cb-btnbb-KJ6tt',
    scenarioId: 'BTN_vs_BB',
    board: ['Kh', 'Jd', '6h'],
    textures: ['K-high', 'broadway', 'two-tone'],
    answer: 'mixed',
    explanation:
      'BTNのKxとJxがナッツを形成しやすいが、ツートーンでBBのQTs・JTs等がフラッシュドローを持つ。ナッツ優位はBTN有利だが、フラッシュドロー含みのBBレンジを考慮してミックスが適切。',
  },
  {
    id: 'cb-btnbb-A96r',
    scenarioId: 'BTN_vs_BB',
    board: ['Ad', '9s', '6c'],
    textures: ['A-high', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BTNのAxがナッツを独占的に保有。BBは96s・A9s等が一部刺さるが、A96レインボーでのBTNのレンジ有利は明確。高頻度CBが最善。',
  },
  {
    id: 'cb-btnbb-JT7r',
    scenarioId: 'BTN_vs_BB',
    board: ['Jh', 'Tc', '7d'],
    textures: ['broadway', 'middle-connected', 'rainbow', 'wet'],
    answer: 'mixed',
    explanation:
      'JT7はBTNのJx・Tx優位があるが、BBの98s・89s・QTs等がストレートドローを形成する。ナッツ（Q・K等のストレート）は拮抗しており、ミックス戦略が適切。',
  },
  {
    id: 'cb-btnbb-K36r',
    scenarioId: 'BTN_vs_BB',
    board: ['Kc', '3h', '6d'],
    textures: ['K-high', 'rainbow', 'dry'],
    answer: 'high',
    explanation:
      'BTNのKxがナッツを形成しBBのコールレンジにはK36に刺さるハンドが少ない。超ドライなK低ランクボードでBTNのレンジ有利が最大限。高頻度CBが最適。',
  },

  // ── Additional mixed scenarios ──────────────────────────────────────────────
  {
    id: 'cb-btnbb-QJ8tt',
    scenarioId: 'BTN_vs_BB',
    board: ['Qc', 'Jh', '8c'],
    textures: ['broadway', 'two-tone', 'wet'],
    answer: 'mixed',
    explanation:
      'QJ8ツートーンはBTNのQJ・AQ・AJ等がナッツ級だが、BBのQJ・JTs・T9s・KTs等が多くヒットする。フラッシュドローも加わりナッツ分布が拮抗。CB頻度はミックスが適切。',
  },
  {
    id: 'cb-btnbb-KQ9tt',
    scenarioId: 'BTN_vs_BB',
    board: ['Kd', 'Qd', '9c'],
    textures: ['K-high', 'broadway', 'two-tone'],
    answer: 'mixed',
    explanation:
      'KQ9ツートーンはBTNのKQ（2ペア）がナッツだが、BBのKQ・QJ・KJ等もブロードウェイを持つ。フラッシュドローも存在しCB頻度はやや抑えてミックスが最善。',
  },
  {
    id: 'cb-btnbb-A8s-tt',
    scenarioId: 'BTN_vs_BB',
    board: ['As', '8d', '5d'],
    textures: ['A-high', 'two-tone'],
    answer: 'mixed',
    explanation:
      'AハイのツートーンはBTNのAxが優位だが、BBのフラッシュドロー（ダイヤモンド）と85s等の2ペアが存在する。純粋なA-highのドライボードより一段CB頻度を下げてミックスが適切。',
  },
  {
    id: 'cb-btnbb-J96tt',
    scenarioId: 'BTN_vs_BB',
    board: ['Jh', '9s', '6h'],
    textures: ['broadway', 'middle-connected', 'two-tone', 'wet'],
    answer: 'mixed',
    explanation:
      'J96ツートーンはBTNのJxが優位だが、BBのT8s・87s・97s等がストレートドローを持ちフラッシュドローも加わる。ナッツ分布は拮抗しており、ミックス戦略でポーカーレンジを守る。',
  },
  {
    id: 'cb-btnbb-K93r',
    scenarioId: 'BTN_vs_BB',
    board: ['Kh', '9d', '3s'],
    textures: ['K-high', 'rainbow', 'dry'],
    answer: 'mixed',
    explanation:
      'BTNのKxはナッツ優位だが、BBの93s・K9s等が一部刺さる。K9のミドルカードがあることで純粋なK低ランクボードより連結性が増し、CB頻度はミックス程度が適切。',
  },
  {
    id: 'cb-btnbb-AT9tt',
    scenarioId: 'BTN_vs_BB',
    board: ['As', 'Td', '9s'],
    textures: ['A-high', 'two-tone', 'wet'],
    answer: 'mixed',
    explanation:
      'BTNのAxとTxがナッツ級だが、BBのJTs・T9s・QTs等がヒットしやすい。ツートーンにフラッシュドローも加わりAT9はAxx系の中でBB有利が出やすいボード。ミックスが適切。',
  },
];
