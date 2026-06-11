import { supabase } from '../../lib/supabase';
import type { SavedHand } from '../history';

/**
 * versus_hands テーブルへ SavedHand を insert する。
 * ログイン中かつ supabase が有効なときのみ呼ぶ。
 * 失敗しても投げない（ローカル state が正）。
 */
export async function insertHand(userId: string, hand: SavedHand): Promise<void> {
  if (supabase === null) return;
  const { error } = await supabase.from('versus_hands').insert({
    user_id: userId,
    session_id: null,        // 単発モードは session_id なし
    ts: hand.ts,
    mode: hand.mode,
    hero_pos: hand.heroPos,
    hero_net: hand.heroNet,
    payload: hand as unknown as Record<string, unknown>,
  });
  if (error) {
    console.warn('[hands] insert failed:', error.message);
  }
}

/**
 * versus_hands テーブルから SavedHand[] を取得する（新しい順、最大 limit 件）。
 * ログイン中かつ supabase が有効なときのみ呼ぶ。
 */
export async function fetchHands(userId: string, limit = 100): Promise<SavedHand[]> {
  if (supabase === null) return [];
  const { data, error } = await supabase
    .from('versus_hands')
    .select('payload')
    .eq('user_id', userId)
    .order('ts', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[hands] fetch failed:', error.message);
    return [];
  }
  return (data ?? []).map((row) => row.payload as SavedHand);
}

/**
 * versus_hands に SavedHand[] を bulk insert する（移行用途）。
 * 重複（ts 衝突）は無視する。
 */
export async function bulkInsertHands(userId: string, hands: SavedHand[]): Promise<void> {
  if (supabase === null || hands.length === 0) return;
  const rows = hands.map((hand) => ({
    user_id: userId,
    session_id: null,
    ts: hand.ts,
    mode: hand.mode,
    hero_pos: hand.heroPos,
    hero_net: hand.heroNet,
    payload: hand as unknown as Record<string, unknown>,
  }));
  const { error } = await supabase.from('versus_hands').upsert(rows, {
    onConflict: 'user_id,ts',
    ignoreDuplicates: true,
  });
  if (error) {
    console.warn('[hands] bulk insert failed:', error.message);
  }
}
