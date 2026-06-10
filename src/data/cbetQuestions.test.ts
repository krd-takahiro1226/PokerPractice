import { describe, expect, it } from 'vitest';
import { isCard } from '../core/cards';
import { CBET_QUESTIONS, CBET_SCENARIOS } from './cbetQuestions';

const VALID_STRATEGIES = new Set(['high', 'mixed', 'check']);
const scenarioIds = new Set(CBET_SCENARIOS.map((s) => s.id));

describe('CBET_QUESTIONS', () => {
  it('has at least 40 questions', () => {
    expect(CBET_QUESTIONS.length).toBeGreaterThanOrEqual(40);
  });

  it('all IDs are unique', () => {
    const ids = CBET_QUESTIONS.map((q) => q.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('each question has a valid scenarioId', () => {
    for (const q of CBET_QUESTIONS) {
      expect(scenarioIds.has(q.scenarioId), `${q.id}: unknown scenarioId "${q.scenarioId}"`).toBe(true);
    }
  });

  it('each question has exactly 3 board cards', () => {
    for (const q of CBET_QUESTIONS) {
      expect(q.board.length, `${q.id}: board length`).toBe(3);
    }
  });

  it('all board cards are valid Card strings', () => {
    for (const q of CBET_QUESTIONS) {
      for (const card of q.board) {
        expect(isCard(card), `${q.id}: invalid card "${card}"`).toBe(true);
      }
    }
  });

  it('no duplicate board cards within a question', () => {
    for (const q of CBET_QUESTIONS) {
      const unique = new Set(q.board);
      expect(unique.size, `${q.id}: duplicate card in board`).toBe(3);
    }
  });

  it('answer is one of high|mixed|check', () => {
    for (const q of CBET_QUESTIONS) {
      expect(VALID_STRATEGIES.has(q.answer), `${q.id}: invalid answer "${q.answer}"`).toBe(true);
    }
  });

  it('textures array is non-empty', () => {
    for (const q of CBET_QUESTIONS) {
      expect(q.textures.length, `${q.id}: empty textures`).toBeGreaterThan(0);
    }
  });

  it('explanation is a non-empty string', () => {
    for (const q of CBET_QUESTIONS) {
      expect(typeof q.explanation).toBe('string');
      expect(q.explanation.length, `${q.id}: empty explanation`).toBeGreaterThan(0);
    }
  });
});
