import { supabase } from '../../lib/supabase';
import type { SessionRecord } from '../sessions';

/** versus_sessions に新規セッションを insert し、生成された ID を返す。 */
export async function insertSession(
  userId: string,
  record: Omit<SessionRecord, 'id' | 'endedAt' | 'result' | 'handsPlayed' | 'stackCurve'>,
): Promise<string | null> {
  if (supabase === null) return null;
  const { data, error } = await supabase
    .from('versus_sessions')
    .insert({
      user_id: userId,
      format: record.format,
      mode: record.mode,
      difficulty: record.difficulty,
      starting_stack: record.startingStack,
      started_at: new Date(record.startedAt).toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    console.warn('[sessions] insert failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}

/** versus_sessions の終了情報を update する。 */
export async function updateSession(
  userId: string,
  sessionId: string,
  patch: {
    result: 'bust' | 'win' | 'quit';
    handsPlayed: number;
    stackCurve: number[];
  },
): Promise<void> {
  if (supabase === null) return;
  const { error } = await supabase
    .from('versus_sessions')
    .update({
      ended_at: new Date().toISOString(),
      result: patch.result,
      hands_played: patch.handsPlayed,
      stack_curve: patch.stackCurve,
    })
    .eq('id', sessionId)
    .eq('user_id', userId);

  if (error) {
    console.warn('[sessions] update failed:', error.message);
  }
}

/** versus_sessions から SessionRecord[] を取得する（新しい順、最大 limit 件）。 */
export async function fetchSessions(userId: string, limit = 50): Promise<SessionRecord[]> {
  if (supabase === null) return [];
  const { data, error } = await supabase
    .from('versus_sessions')
    .select('id, format, mode, difficulty, starting_stack, started_at, ended_at, result, hands_played, stack_curve')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[sessions] fetch failed:', error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    format: row.format as SessionRecord['format'],
    mode: row.mode as SessionRecord['mode'],
    difficulty: row.difficulty as SessionRecord['difficulty'],
    startingStack: row.starting_stack as number,
    startedAt: new Date(row.started_at as string).getTime(),
    endedAt: row.ended_at ? new Date(row.ended_at as string).getTime() : null,
    result: (row.result as SessionRecord['result']) ?? null,
    handsPlayed: (row.hands_played as number) ?? 0,
    stackCurve: (row.stack_curve as number[]) ?? [],
  }));
}

/** versus_sessions を一括 insert（移行用途）。 */
export async function bulkInsertSessions(
  userId: string,
  sessions: SessionRecord[],
): Promise<void> {
  if (supabase === null || sessions.length === 0) return;
  const rows = sessions.map((s) => ({
    id: s.id,
    user_id: userId,
    format: s.format,
    mode: s.mode,
    difficulty: s.difficulty,
    starting_stack: s.startingStack,
    started_at: new Date(s.startedAt).toISOString(),
    ended_at: s.endedAt ? new Date(s.endedAt).toISOString() : null,
    result: s.result,
    hands_played: s.handsPlayed,
    stack_curve: s.stackCurve,
  }));
  const { error } = await supabase
    .from('versus_sessions')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  if (error) {
    console.warn('[sessions] bulk insert failed:', error.message);
  }
}
