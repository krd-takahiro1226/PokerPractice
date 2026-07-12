import { ALL_HAND_CLASSES, type HandClass } from '../../../src/core/handNotation';
import { getEffectiveRange, rfiKey } from '../../../src/core/ranges/effective';
import { getVsOpen } from '../../../src/core/ranges/vsOpen';
import { sprBucketOf, type SprBucket } from '../../../src/core/solver/types';

// スターター構成 srp-btn-bb（docs/SOLVER-REVIEW-DESIGN.md §12.2.1）。
// SRP、BTN=オープナー(IP) vs BB=コーラー(OOP)、cash-noante 100bb。
// pot 5.5bb・eff stack 97.5bb → sprBucket 'gt6'。

export type BetSizeSpec = { bet: number[]; raise: number[]; allin: boolean };

export type PresolveConfig = {
  name: string;
  potType: 'srp';
  ip: { pos: 'BTN' };
  oop: { pos: 'BB' };
  mode: 'cash-noante';
  /** bb 単位（非スケール）。set_pot / set_effective_stack は scale を掛けた整数で渡す */
  potBB: number;
  effStackBB: number;
  /** 浮動小数を避けるための整数スケール（bb×scale）。meta に記録する */
  scale: number;
  sprBucket: SprBucket;
  tree: { flop: BetSizeSpec; turn: BetSizeSpec; river: BetSizeSpec };
  allinThreshold: number;
  accuracyTargetPctPot: number;
  /** exploitability の失敗判定閾値（% of pot）。超過時は出力しない */
  failThresholdPctPot: number;
  maxIteration: number;
  /** 初回で failThresholdPctPot を超えた場合の再挑戦反復数 */
  retryMaxIteration: number;
  /** ip/oop の入力レンジ（handClass → 頻度 0..1）。meta にそのまま保存する */
  ranges: { ip: Partial<Record<HandClass, number>>; oop: Partial<Record<HandClass, number>> };
};

/** チャートから range を抽出（既存チャートの重複実装をしない）。 */
function extractRange(
  getFreq: (hc: HandClass) => number | undefined,
): Partial<Record<HandClass, number>> {
  const out: Partial<Record<HandClass, number>> = {};
  for (const hc of ALL_HAND_CLASSES) {
    const freq = getFreq(hc);
    if (freq !== undefined && freq > 0) out[hc] = freq;
  }
  return out;
}

export function buildSrpBtnBbConfig(): PresolveConfig {
  const potBB = 5.5;
  const effStackBB = 97.5;
  const scale = 10;

  const btnRfi = getEffectiveRange(rfiKey('BTN'), 'cash-noante');
  if (!btnRfi) throw new Error('presolve: BTN RFI range (cash-noante) not found');
  const bbVsOpen = getVsOpen('BB', 'BTN');
  if (!bbVsOpen) throw new Error('presolve: BB vsOpen BTN scenario not found');

  const ipRange = extractRange((hc) => btnRfi[hc]?.raise);
  const oopRange = extractRange((hc) => bbVsOpen.range[hc]?.call);
  if (Object.keys(ipRange).length === 0) throw new Error('presolve: BTN RFI range is empty');
  if (Object.keys(oopRange).length === 0) throw new Error('presolve: BB vsOpen call range is empty');

  return {
    name: 'srp-btn-bb',
    potType: 'srp',
    ip: { pos: 'BTN' },
    oop: { pos: 'BB' },
    mode: 'cash-noante',
    potBB,
    effStackBB,
    scale,
    sprBucket: sprBucketOf(effStackBB / potBB),
    // 逸脱（2026-07-10・意図的な品質妥協）: 当初計画（turn/river raise 60 あり・
    // threshold 0.67・accuracy 0.5・maxIter 120）は SPR 17.7 の木では収束不能だった
    // （実測: 40反復 3,083秒で exploitability 10.8%・8コア8GB Mac）。
    // → turn/river の raise を削除（bet 75 + allin のみ）、allin_threshold 0.3 で
    //   flop raise 連鎖を早期に allin へ併合、accuracy 0.9 / maxIter 150 に緩和。
    // flop の bet {33,75} / raise 60 / allin は主要ユースケース（cbet・vs raise）のため維持。
    // exploitability ゲート 1.0% pot は維持（超過 flop は出力しない）。
    tree: {
      flop: { bet: [33, 75], raise: [60], allin: true },
      turn: { bet: [75], raise: [], allin: true },
      river: { bet: [75], raise: [], allin: true },
    },
    allinThreshold: 0.3,
    accuracyTargetPctPot: 0.9,
    failThresholdPctPot: 1.0,
    maxIteration: 150,
    retryMaxIteration: 300,
    ranges: { ip: ipRange, oop: oopRange },
  };
}

export const PRESOLVE_CONFIGS: Record<string, () => PresolveConfig> = {
  'srp-btn-bb': buildSrpBtnBbConfig,
};
