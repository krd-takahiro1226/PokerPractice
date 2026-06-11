import { supabase } from '../../lib/supabase';

type BookmarkItem = {
  problemKey: string;
  note?: string;
  createdAt: number;
};

export async function insertBookmark(userId: string, item: BookmarkItem): Promise<void> {
  if (supabase === null) return;
  const { error } = await supabase.from('bookmarks').upsert({
    user_id: userId,
    problem_key: item.problemKey,
    note: item.note ?? null,
  }, { onConflict: 'user_id,problem_key' });
  if (error) console.warn('[bookmarks] insert failed:', error.message);
}

export async function deleteBookmark(userId: string, problemKey: string): Promise<void> {
  if (supabase === null) return;
  const { error } = await supabase.from('bookmarks')
    .delete()
    .eq('user_id', userId)
    .eq('problem_key', problemKey);
  if (error) console.warn('[bookmarks] delete failed:', error.message);
}

export async function fetchBookmarks(userId: string): Promise<BookmarkItem[]> {
  if (supabase === null) return [];
  const { data, error } = await supabase
    .from('bookmarks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) { console.warn('[bookmarks] fetch failed:', error.message); return []; }
  return (data ?? []).map((row) => ({
    problemKey: row.problem_key,
    note: row.note ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
  }));
}

export async function bulkUpsertBookmarks(userId: string, items: BookmarkItem[]): Promise<void> {
  if (supabase === null || items.length === 0) return;
  const rows = items.map((item) => ({
    user_id: userId,
    problem_key: item.problemKey,
    note: item.note ?? null,
  }));
  const { error } = await supabase.from('bookmarks').upsert(rows, { onConflict: 'user_id,problem_key' });
  if (error) console.warn('[bookmarks] bulk upsert failed:', error.message);
}
