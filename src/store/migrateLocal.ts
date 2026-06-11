import { supabase } from '../lib/supabase';
import { bulkInsertHands } from './remote/hands';
import { bulkInsertAttempts } from './remote/attempts';
import { bulkUpsertCustomRanges } from './remote/customRanges';
import { bulkUpsertBookmarks } from './remote/bookmarks';
import { bulkInsertSessions } from './remote/sessions';
import type { SavedHand } from './history';
import type { QuizAttempt } from './attempts';
import type { CustomRanges } from '../core/ranges/effective';
import type { SessionRecord } from './sessions';

/**
 * ログイン成功後に1回だけ呼ぶ。
 * profiles.migrated_at が null のときだけ localStorage データを一括インポートし、
 * 完了後に migrated_at を更新する。失敗時は migrated_at を立てず console.warn。
 */
export async function migrateLocalToCloud(userId: string): Promise<void> {
  if (supabase === null) return;

  // profiles 行の存在を保証（なければ insert、あれば何もしない）
  const { error: upsertError } = await supabase
    .from('profiles')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });

  if (upsertError) {
    console.warn('[migrate] profiles upsert failed:', upsertError.message);
    return;
  }

  // migrated_at を確認
  const { data: profile, error: selectError } = await supabase
    .from('profiles')
    .select('migrated_at')
    .eq('user_id', userId)
    .single();

  if (selectError) {
    console.warn('[migrate] profiles select failed:', selectError.message);
    return;
  }

  // すでに移行済みなら何もしない（二重移行防止）
  if (profile.migrated_at !== null) return;

  try {
    await migrateHistory(userId);
    await migrateAttempts(userId);
    await migrateCustomRanges(userId);
    await migrateBookmarks(userId);
    await migrateSessions(userId);
  } catch (e) {
    console.warn('[migrate] migration failed, migrated_at not set:', e);
    return;
  }

  // 移行成功後に migrated_at を更新
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ migrated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (updateError) {
    console.warn('[migrate] migrated_at update failed:', updateError.message);
  }
}

/** localStorage の poker-trainer-history を versus_hands に bulk insert。 */
async function migrateHistory(userId: string): Promise<void> {
  const raw = localStorage.getItem('poker-trainer-history');
  if (raw === null) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  // zustand persist の保存形式: { state: { hands: SavedHand[] }, version: number }
  const state = (parsed as { state?: { hands?: unknown[] } })?.state;
  const hands = state?.hands;
  if (!Array.isArray(hands) || hands.length === 0) return;

  await bulkInsertHands(userId, hands as SavedHand[]);
}

async function migrateAttempts(userId: string): Promise<void> {
  const raw = localStorage.getItem('poker-trainer-attempts');
  if (raw === null) return;
  try {
    const parsed = JSON.parse(raw);
    const attempts = Array.isArray(parsed) ? parsed : [];
    if (attempts.length === 0) return;
    await bulkInsertAttempts(userId, attempts as QuizAttempt[]);
  } catch { return; }
}

async function migrateCustomRanges(userId: string): Promise<void> {
  const raw = localStorage.getItem('poker-trainer-custom-ranges');
  if (raw === null) return;
  try {
    const parsed = JSON.parse(raw) as CustomRanges;
    if (!parsed || typeof parsed !== 'object') return;
    await bulkUpsertCustomRanges(userId, parsed);
  } catch { return; }
}

async function migrateBookmarks(userId: string): Promise<void> {
  const raw = localStorage.getItem('poker-trainer-bookmarks');
  if (raw === null) return;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    await bulkUpsertBookmarks(userId, parsed);
  } catch { return; }
}

async function migrateSessions(userId: string): Promise<void> {
  const raw = localStorage.getItem('poker-trainer-sessions');
  if (raw === null) return;
  try {
    // zustand persist 保存形式: { state: { sessions: SessionRecord[] }, version: number }
    const parsed = JSON.parse(raw);
    const state = (parsed as { state?: { sessions?: unknown[] } })?.state;
    const sessions = state?.sessions;
    if (!Array.isArray(sessions) || sessions.length === 0) return;
    await bulkInsertSessions(userId, sessions as SessionRecord[]);
  } catch { return; }
}
