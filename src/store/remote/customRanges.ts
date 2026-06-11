import { supabase } from '../../lib/supabase';
import type { CustomRanges, RangeKey } from '../../core/ranges/effective';
import type { Range } from '../../core/ranges/types';

export async function fetchCustomRanges(userId: string): Promise<CustomRanges> {
  if (supabase === null) return {};
  const { data, error } = await supabase
    .from('custom_ranges')
    .select('range_key, range')
    .eq('user_id', userId);
  if (error) { console.warn('[customRanges] fetch failed:', error.message); return {}; }
  const result: CustomRanges = {};
  for (const row of data ?? []) {
    result[row.range_key as RangeKey] = row.range as Range;
  }
  return result;
}

export async function upsertCustomRange(userId: string, key: RangeKey, range: Range): Promise<void> {
  if (supabase === null) return;
  const { error } = await supabase.from('custom_ranges').upsert({
    user_id: userId,
    range_key: key,
    range,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,range_key' });
  if (error) console.warn('[customRanges] upsert failed:', error.message);
}

export async function deleteCustomRange(userId: string, key: RangeKey): Promise<void> {
  if (supabase === null) return;
  const { error } = await supabase.from('custom_ranges')
    .delete()
    .eq('user_id', userId)
    .eq('range_key', key);
  if (error) console.warn('[customRanges] delete failed:', error.message);
}

export async function bulkUpsertCustomRanges(userId: string, ranges: CustomRanges): Promise<void> {
  if (supabase === null) return;
  const rows = Object.entries(ranges).map(([key, range]) => ({
    user_id: userId,
    range_key: key,
    range,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return;
  const { error } = await supabase.from('custom_ranges').upsert(rows, { onConflict: 'user_id,range_key' });
  if (error) console.warn('[customRanges] bulk upsert failed:', error.message);
}
