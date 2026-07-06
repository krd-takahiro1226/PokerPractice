import { cardsToHandClass } from '../handNotation';
import { primaryAction } from '../ranges/types';
import { estimateEquityVsRanges } from '../ai/estimateEquity';
import { estimatePlayerRange, buildBroadRange } from '../ai/villainRange';
import { potOdds as calcPotOdds, mdf as calcMdf } from '../potOdds';
import { getEffectiveRange, rfiKey, vsOpenKey, type CustomRanges } from '../ranges/effective';
import type { Street, PlayerActionType, HandLogEntry } from '../game/types';
import type { SavedHand } from '../../store/history';
import type { Position } from '../ranges/types';
import type { Card } from '../cards';

export type DecisionVerdict = 'good' | 'ok' | 'mistake' | 'info';

export type DecisionReview = {
  logIndex: number;
  street: Street;
  heroAction: PlayerActionType;
  verdict: DecisionVerdict;
  headline: string;
  detail: string;
  metrics?: {
    heroEquity?: number;
    potOdds?: number;
    mdf?: number;
  };
};

export function reviewHand(hand: SavedHand, custom?: CustomRanges): DecisionReview[] {
  const reviews: DecisionReview[] = [];
  const heroLogs = hand.log
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => entry.playerId === 0);

  for (const { entry, i } of heroLogs) {
    const review = reviewDecision(hand, entry, i, custom);
    if (review) reviews.push(review);
  }

  return reviews;
}

function reviewDecision(
  hand: SavedHand,
  entry: HandLogEntry,
  logIndex: number,
  custom?: CustomRanges,
): DecisionReview | null {
  if (entry.street === 'preflop') {
    return reviewPreflopDecision(hand, entry, logIndex, custom);
  }
  return reviewPostflopDecision(hand, entry, logIndex);
}

function reviewPreflopDecision(
  hand: SavedHand,
  entry: HandLogEntry,
  logIndex: number,
  custom?: CustomRanges,
): DecisionReview {
  const handClass = cardsToHandClass(hand.heroHole[0], hand.heroHole[1]);
  const heroPos = hand.heroPos;

  // Was there an opener before hero acted?
  const logsBeforeHero = hand.log.slice(0, logIndex).filter((l) => l.street === 'preflop');
  const hasOpener = logsBeforeHero.some(
    (l) => l.playerId !== 0 && l.action === 'raise',
  );

  if (!hasOpener) {
    return reviewRFI(hand, entry, logIndex, handClass, heroPos, custom);
  }

  return reviewVsOpen(hand, entry, logIndex, handClass, heroPos, logsBeforeHero, custom);
}

function reviewRFI(
  hand: SavedHand,
  entry: HandLogEntry,
  logIndex: number,
  handClass: string,
  heroPos: Position,
  custom?: CustomRanges,
): DecisionReview {
  const mode = hand.mode ?? 'tournament';
  const range = getEffectiveRange(rfiKey(heroPos), mode, custom);

  if (!range) {
    return {
      logIndex,
      street: 'preflop',
      heroAction: entry.action,
      verdict: 'info',
      headline: 'レンジデータなし（参考情報のみ）',
      detail: `${heroPos} の RFI レンジデータがありません。`,
    };
  }

  const rangeAction = range[handClass];
  const isInRange = (rangeAction?.raise ?? 0) > 0;
  const heroRaised = entry.action === 'raise' || entry.action === 'bet';
  const heroFolded = entry.action === 'fold';

  if (isInRange && heroRaised) {
    return {
      logIndex,
      street: 'preflop',
      heroAction: entry.action,
      verdict: 'good',
      headline: 'オープン妥当',
      detail: `${handClass} は ${heroPos} のRFIレンジ内です。オープンは正しい判断です。`,
    };
  }

  if (isInRange && heroFolded) {
    return {
      logIndex,
      street: 'preflop',
      heroAction: entry.action,
      verdict: 'mistake',
      headline: 'フォールド推奨されない',
      detail: `${handClass} は ${heroPos} のRFIレンジ内です。タイトすぎるフォールドです。オープンを推奨します。`,
    };
  }

  if (!isInRange && heroFolded) {
    return {
      logIndex,
      street: 'preflop',
      heroAction: entry.action,
      verdict: 'good',
      headline: 'フォールド妥当',
      detail: `${handClass} は ${heroPos} のRFIレンジ外です。フォールドは正しい判断です。`,
    };
  }

  if (!isInRange && heroRaised) {
    return {
      logIndex,
      street: 'preflop',
      heroAction: entry.action,
      verdict: 'mistake',
      headline: 'オープン推奨されない',
      detail: `${handClass} は ${heroPos} のRFIレンジ外です。ルースなオープンです。`,
    };
  }

  // call in RFI spot
  return {
    logIndex,
    street: 'preflop',
    heroAction: entry.action,
    verdict: 'info',
    headline: 'コール（リンプ）',
    detail: `RFI状況でのコールはアドバンテージが低くなりがちです。レンジ内なら${isInRange ? 'オープン' : 'フォールド'}を検討しましょう。`,
  };
}

function reviewVsOpen(
  hand: SavedHand,
  entry: HandLogEntry,
  logIndex: number,
  handClass: string,
  heroPos: Position,
  logsBeforeHero: HandLogEntry[],
  custom?: CustomRanges,
): DecisionReview {
  // Find the opener's position
  const openerLog = logsBeforeHero.find(
    (l) => l.playerId !== 0 && (l.action === 'raise' || l.action === 'bet'),
  );
  const openerPos = openerLog?.pos;

  if (!openerPos) {
    return {
      logIndex,
      street: 'preflop',
      heroAction: entry.action,
      verdict: 'info',
      headline: '参考情報のみ',
      detail: 'オープナーのポジションを特定できませんでした。',
    };
  }

  const mode = hand.mode ?? 'tournament';
  const range = getEffectiveRange(vsOpenKey(openerPos as Position, heroPos), mode, custom);

  if (!range) {
    return {
      logIndex,
      street: 'preflop',
      heroAction: entry.action,
      verdict: 'info',
      headline: 'レンジデータなし（参考情報のみ）',
      detail: `vs ${openerPos} open（あなた${heroPos}）のレンジデータがありません。一般的にはプレミアムハンドで3bet、中程度でコール、弱い手でフォールドが推奨です。`,
    };
  }

  const rangeAction = range[handClass];
  const pa = primaryAction(rangeAction);
  const heroAction = entry.action;
  const heroFolded = heroAction === 'fold';
  const heroRaised = heroAction === 'raise';
  const heroCalled = heroAction === 'call';

  if (pa === 'raise') {
    if (heroRaised) {
      return {
        logIndex,
        street: 'preflop',
        heroAction,
        verdict: 'good',
        headline: '3bet妥当',
        detail: `${handClass} は vs ${openerPos} の3betレンジです。3betは正しい判断です。`,
      };
    }
    if (heroCalled) {
      return {
        logIndex,
        street: 'preflop',
        heroAction,
        verdict: 'ok',
        headline: '3betが推奨、コールも可',
        detail: `${handClass} は vs ${openerPos} の推奨3betレンジです。コールも選択肢ですが、3betが望ましいです。`,
      };
    }
    if (heroFolded) {
      return {
        logIndex,
        street: 'preflop',
        heroAction,
        verdict: 'mistake',
        headline: 'フォールド推奨されない',
        detail: `${handClass} は vs ${openerPos} の3betレンジです。3betまたはコールが推奨されます。`,
      };
    }
  }

  if (pa === 'call') {
    if (heroCalled) {
      return {
        logIndex,
        street: 'preflop',
        heroAction,
        verdict: 'good',
        headline: 'コール妥当',
        detail: `${handClass} は vs ${openerPos} のコールレンジです。コールは正しい判断です。`,
      };
    }
    if (heroRaised) {
      return {
        logIndex,
        street: 'preflop',
        heroAction,
        verdict: 'ok',
        headline: '3bet（コール推奨だが誤りでない）',
        detail: `${handClass} は vs ${openerPos} のコールレンジですが、3betも選択肢として検討できます。`,
      };
    }
    if (heroFolded) {
      return {
        logIndex,
        street: 'preflop',
        heroAction,
        verdict: 'mistake',
        headline: 'フォールド推奨されない',
        detail: `${handClass} は vs ${openerPos} のコールレンジです。コールが推奨されます。`,
      };
    }
  }

  // fold is recommended (hand not in range)
  if (heroFolded) {
    return {
      logIndex,
      street: 'preflop',
      heroAction,
      verdict: 'good',
      headline: 'フォールド妥当',
      detail: `${handClass} は vs ${openerPos} のコール/3betレンジ外です。フォールドは正しい判断です。`,
    };
  }

  if (heroCalled || heroRaised) {
    return {
      logIndex,
      street: 'preflop',
      heroAction,
      verdict: 'mistake',
      headline: 'フォールド推奨',
      detail: `${handClass} は vs ${openerPos} のレンジ外です。フォールドが推奨されます。`,
    };
  }

  return {
    logIndex,
    street: 'preflop',
    heroAction,
    verdict: 'info',
    headline: '参考情報のみ',
    detail: 'この状況の詳細レンジデータがありません。',
  };
}

function reviewPostflopDecision(
  hand: SavedHand,
  entry: HandLogEntry,
  logIndex: number,
): DecisionReview {
  const review = computePostflopVerdict(hand, entry, logIndex);
  const villainCount = getSurvivingVillainIds(hand, logIndex).length;
  if (villainCount >= 2) {
    return {
      ...review,
      detail: `${review.detail}\n※マルチウェイ（相手${villainCount}人）のためレンジ推定は目安です。`,
    };
  }
  return review;
}

/** 生存している(hero除く・logIndexより前にfoldしていない)相手playerIdの一覧。 */
function getSurvivingVillainIds(hand: SavedHand, logIndex: number): number[] {
  const dealtIds = new Set<number>(hand.log.map((e) => e.playerId));
  dealtIds.delete(0); // hero除外
  const foldedBefore = new Set<number>(
    hand.log.slice(0, logIndex).filter((e) => e.action === 'fold').map((e) => e.playerId),
  );
  return [...dealtIds].filter((id) => !foldedBefore.has(id)).sort((a, b) => a - b);
}

function computePostflopVerdict(
  hand: SavedHand,
  entry: HandLogEntry,
  logIndex: number,
): DecisionReview {
  const board = getBoardAtStreet(hand, entry.street);
  if (board.length === 0 || !hand.heroHole) {
    return {
      logIndex,
      street: entry.street,
      heroAction: entry.action,
      verdict: 'info',
      headline: '情報不足',
      detail: 'ボード情報が不足しています。',
    };
  }

  // 判断時点(logIndex)で生存している相手全員のプリフロップログから推定レンジを構築
  const villainIds = getSurvivingVillainIds(hand, logIndex);
  const villainRanges = villainIds.length > 0
    ? villainIds.map((pid) => estimatePlayerRange(hand.log, pid, hand.mode ?? 'tournament'))
    : [buildBroadRange()];

  // Estimate equity (2000 iterations, sync)
  const heroEquity = estimateEquityVsRanges(
    hand.heroHole,
    board,
    villainRanges,
    2000,
  );

  // Compute pot and call amount at this decision point.
  // log の amount は total-commit のため、同ストリートの直前コミットを引いて追加支払い額に変換する
  const heroPrior = heroCommittedBefore(hand, entry, logIndex);
  const heroAdditional = entry.amount !== undefined ? Math.max(0, entry.amount - heroPrior) : 0;
  const potAtDecision = entry.potAfter - heroAdditional;
  const callAmount = computeCallAmount(hand, entry, logIndex, heroPrior);
  const potOddsVal = callAmount > 0 ? calcPotOdds(potAtDecision, callAmount) : 0;

  // Compute MDF based on villain's bet
  const villainBetAmount = computeVillainBet(hand, entry, logIndex);
  const mdfVal = villainBetAmount > 0 ? calcMdf(potAtDecision - villainBetAmount, villainBetAmount) : 0;

  const heroAction = entry.action;
  const heroFolded = heroAction === 'fold';
  const heroCalled = heroAction === 'call';
  const heroChecked = heroAction === 'check';
  const heroBet = heroAction === 'bet' || heroAction === 'raise';

  const metrics = {
    heroEquity,
    potOdds: potOddsVal > 0 ? potOddsVal : undefined,
    mdf: mdfVal > 0 ? mdfVal : undefined,
  };

  // Bet/check situation (hero had initiative)
  if (heroChecked || heroBet) {
    if (heroBet && heroEquity >= 0.55) {
      return {
        logIndex,
        street: entry.street,
        heroAction,
        verdict: 'good',
        headline: 'バリューベット妥当',
        detail: `ヒーローのエクイティは ${pct(heroEquity)} と高く、ベットは正しい判断です。`,
        metrics,
      };
    }
    if (heroBet && heroEquity < 0.35) {
      return {
        logIndex,
        street: entry.street,
        heroAction,
        verdict: 'ok',
        headline: 'ブラフ（判断は状況次第）',
        detail: `エクイティは ${pct(heroEquity)} と低め。バランスブラフとしては一定の合理性があります（近似値です）。`,
        metrics,
      };
    }
    if (heroChecked && heroEquity >= 0.65) {
      return {
        logIndex,
        street: entry.street,
        heroAction,
        verdict: 'ok',
        headline: 'チェック（ベット推奨）',
        detail: `エクイティが ${pct(heroEquity)} と高く、バリューベットの機会があります。`,
        metrics,
      };
    }
    return {
      logIndex,
      street: entry.street,
      heroAction,
      verdict: 'ok',
      headline: heroChecked ? 'チェック妥当' : 'ベット（判断は状況次第）',
      detail: `ヒーローエクイティ: ${pct(heroEquity)}。`,
      metrics,
    };
  }

  // Call/fold situation (villain bet)
  if (heroCalled || heroFolded) {
    if (potOddsVal === 0) {
      return {
        logIndex,
        street: entry.street,
        heroAction,
        verdict: 'info',
        headline: 'ポットオッズ計算不可',
        detail: `ヒーローエクイティ: ${pct(heroEquity)}。`,
        metrics,
      };
    }

    const shouldCall = heroEquity >= potOddsVal;

    if (shouldCall && heroCalled) {
      return {
        logIndex,
        street: entry.street,
        heroAction,
        verdict: 'good',
        headline: 'コール妥当',
        detail: `エクイティ ${pct(heroEquity)} ≥ 必要勝率 ${pct(potOddsVal)}。コールは正しい判断です。`,
        metrics,
      };
    }

    if (shouldCall && heroFolded) {
      return {
        logIndex,
        street: entry.street,
        heroAction,
        verdict: 'mistake',
        headline: 'コールが推奨',
        detail: `エクイティ ${pct(heroEquity)} ≥ 必要勝率 ${pct(potOddsVal)}。フォールドはポットオッズに合いません。`,
        metrics,
      };
    }

    if (!shouldCall && heroFolded) {
      return {
        logIndex,
        street: entry.street,
        heroAction,
        verdict: 'good',
        headline: 'フォールド妥当',
        detail: `エクイティ ${pct(heroEquity)} < 必要勝率 ${pct(potOddsVal)}。フォールドは正しい判断です。`,
        metrics,
      };
    }

    if (!shouldCall && heroCalled) {
      return {
        logIndex,
        street: entry.street,
        heroAction,
        verdict: 'mistake',
        headline: 'フォールド推奨',
        detail: `エクイティ ${pct(heroEquity)} < 必要勝率 ${pct(potOddsVal)}。コールはポットオッズに合いません。`,
        metrics,
      };
    }
  }

  return {
    logIndex,
    street: entry.street,
    heroAction,
    verdict: 'info',
    headline: '参考情報のみ',
    detail: `ヒーローエクイティ: ${pct(heroEquity)}。`,
    metrics,
  };
}

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function getBoardAtStreet(hand: SavedHand, street: Street): Card[] {
  // Return the board cards available at the beginning of this street
  switch (street) {
    case 'preflop': return [];
    case 'flop': return hand.board.slice(0, 3);
    case 'turn': return hand.board.slice(0, 4);
    case 'river': return hand.board.slice(0, 5);
    default: return hand.board;
  }
}

/** ヒーローがこの判断より前に同ストリートで到達していた total-commit。 */
function heroCommittedBefore(hand: SavedHand, entry: HandLogEntry, logIndex: number): number {
  const prior = hand.log
    .slice(0, logIndex)
    .filter((l) => l.street === entry.street && l.playerId === 0 && l.amount !== undefined);
  return prior[prior.length - 1]?.amount ?? 0;
}

function computeCallAmount(
  hand: SavedHand,
  entry: HandLogEntry,
  logIndex: number,
  heroPrior: number,
): number {
  // For call/fold decisions: 直面していた total-commit 目標 − ヒーローの既コミット = 追加支払い額
  if (entry.action === 'call' && entry.amount !== undefined) {
    return Math.max(0, entry.amount - heroPrior);
  }
  if (entry.action === 'call' || entry.action === 'fold') {
    // 古い保存データで call の amount が無い場合や fold は、直前の bet/raise から復元
    const priorBets = hand.log
      .slice(0, logIndex)
      .filter((l) => l.street === entry.street && (l.action === 'bet' || l.action === 'raise' || l.action === 'allin'));
    const lastBet = priorBets[priorBets.length - 1];
    if (lastBet?.amount) return Math.max(0, lastBet.amount - heroPrior);
  }
  return 0;
}

function computeVillainBet(hand: SavedHand, entry: HandLogEntry, logIndex: number): number {
  const priorBets = hand.log
    .slice(0, logIndex)
    .filter((l) => l.street === entry.street && l.playerId !== 0 && (l.action === 'bet' || l.action === 'raise' || l.action === 'allin'));
  const lastBet = priorBets[priorBets.length - 1];
  return lastBet?.amount ?? 0;
}
