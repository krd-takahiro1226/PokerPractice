import { supabase } from '../../lib/supabase';
import type { QuizAttempt } from '../attempts';

export async function insertAttempts(userId: string, attempts: QuizAttempt[]): Promise<void> {
  if (supabase === null || attempts.length === 0) return;
  const rows = attempts.map((a) => ({
    user_id: userId,
    ts: a.ts,
    drill_kind: a.drillKind,
    scenario_id: a.scenarioId ?? null,
    position: a.position ?? null,
    hand_class: a.handClass ?? null,
    expected: a.expected,
    answered: a.answered,
    correct: a.correct,
    payload: a.payload ?? {},
  }));
  const { error } = await supabase.from('quiz_attempts').insert(rows);
  if (error) console.warn('[attempts] insert failed:', error.message);
}

export async function fetchAttempts(userId: string, limit = 2000): Promise<QuizAttempt[]> {
  if (supabase === null) return [];
  const { data, error } = await supabase
    .from('quiz_attempts')
    .select('*')
    .eq('user_id', userId)
    .order('ts', { ascending: false })
    .limit(limit);
  if (error) { console.warn('[attempts] fetch failed:', error.message); return []; }
  return (data ?? []).map((row) => ({
    id: row.id,
    ts: row.ts,
    drillKind: row.drill_kind as QuizAttempt['drillKind'],
    scenarioId: row.scenario_id ?? undefined,
    position: row.position ?? undefined,
    handClass: row.hand_class ?? undefined,
    expected: row.expected,
    answered: row.answered,
    correct: row.correct,
    payload: row.payload ?? undefined,
  }));
}

export async function bulkInsertAttempts(userId: string, attempts: QuizAttempt[]): Promise<void> {
  if (supabase === null || attempts.length === 0) return;
  const rows = attempts.map((a) => ({
    user_id: userId,
    ts: a.ts,
    drill_kind: a.drillKind,
    scenario_id: a.scenarioId ?? null,
    position: a.position ?? null,
    hand_class: a.handClass ?? null,
    expected: a.expected,
    answered: a.answered,
    correct: a.correct,
    payload: a.payload ?? {},
  }));
  const { error } = await supabase.from('quiz_attempts').upsert(rows, {
    onConflict: 'user_id,ts',
    ignoreDuplicates: true,
  });
  if (error) console.warn('[attempts] bulk insert failed:', error.message);
}
