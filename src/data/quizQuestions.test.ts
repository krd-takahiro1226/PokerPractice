import { describe, expect, it } from 'vitest';
import { QUIZ_QUESTIONS } from './quizQuestions';
import { getRfiScenarios } from '../core/ranges/rfi';
import { primaryAction } from '../core/ranges/types';
import type { GameMode } from '../core/ranges/mode';

// モード選定: 事前検証で既存のプリフロップ問題を 'tournament' / 'cash-ante' / 'cash-noante' の
// 全3モードでチェックしたところ、tournament と cash-ante はそれぞれ4件不一致
// （pf-utg-a9o, pf-co-k8s, pf-co-54s, pf-sb-j9o相当）、cash-noante は3件のみの不一致だった
// （tournament/cash-ante はtier数が同一のため同じ結果になる）。
// 不一致が最少の cash-noante を採用し、矛盾していた3問（pf-co-54s→98s, pf-btn-75s→76s,
// pf-sb-j9o→98o への差し替え等）はハンドまたは答えを修正して整合を取った。
const MODE: GameMode = 'cash-noante';

describe('QUIZ_QUESTIONS', () => {
  it('has at least 50 questions', () => {
    expect(QUIZ_QUESTIONS.length).toBeGreaterThanOrEqual(50);
  });

  it('has unique ids', () => {
    const ids = QUIZ_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('answer is always one of the choice values', () => {
    for (const q of QUIZ_QUESTIONS) {
      const values = q.choices.map((c) => c.value);
      expect(values, `question ${q.id} choices should include its answer`).toContain(q.answer);
    }
  });

  describe('preflop fold/raise questions match the range API (mode: cash-noante)', () => {
    const scenarios = getRfiScenarios(MODE);
    const byPos = Object.fromEntries(scenarios.map((s) => [s.heroPos, s]));

    const isFoldRaiseChoice = (choices: { value: string }[]) => {
      const values = new Set(choices.map((c) => c.value));
      return values.size === 2 && values.has('fold') && values.has('raise');
    };

    const preflopQuestions = QUIZ_QUESTIONS.filter(
      (q) => q.context?.heroPos && q.context?.hand && isFoldRaiseChoice(q.choices),
    );

    it('covers a meaningful number of preflop questions', () => {
      expect(preflopQuestions.length).toBeGreaterThanOrEqual(20);
    });

    it.each(preflopQuestions.map((q) => [q.id, q] as const))('%s', (_id, q) => {
      const { heroPos, hand } = q.context!;
      const scenario = byPos[heroPos!];
      expect(scenario, `no RFI scenario for position ${heroPos}`).toBeDefined();
      const expected = primaryAction(scenario.range[hand!]);
      expect(q.answer).toBe(expected);
    });
  });
});
