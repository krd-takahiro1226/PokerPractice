import { create } from 'zustand';
import { localPort, currentUserId } from './persistence';
import { fetchCustomRanges, upsertCustomRange, deleteCustomRange } from './remote/customRanges';
import type { CustomRanges, RangeKey } from '../core/ranges/effective';
import type { Range } from '../core/ranges/types';

const STORAGE_KEY = 'poker-trainer-custom-ranges';

type CustomRangesState = {
  ranges: CustomRanges;
  loaded: boolean;
  load: () => Promise<void>;
  setRange: (key: RangeKey, range: Range) => void;
  resetRange: (key: RangeKey) => void;
  resetAll: () => void;
};

export const useCustomRanges = create<CustomRangesState>()((set, get) => ({
  ranges: {},
  loaded: false,

  load: async () => {
    const uid = currentUserId();
    let ranges: CustomRanges = {};
    if (uid) {
      ranges = await fetchCustomRanges(uid);
    } else {
      const port = localPort<CustomRanges>(STORAGE_KEY, {});
      ranges = await port.load();
    }
    set({ ranges, loaded: true });
  },

  setRange: (key, range) => {
    set((s) => ({ ranges: { ...s.ranges, [key]: range } }));
    const uid = currentUserId();
    if (uid) {
      upsertCustomRange(uid, key, range).catch(() => {});
    } else {
      // read-modify-write で port.load() を経由すると連続保存で古い内容が後勝ちしうるため、
      // set() 済みの最新 in-memory state をそのまま保存する。
      const port = localPort<CustomRanges>(STORAGE_KEY, {});
      port.save(get().ranges).catch(() => {});
    }
  },

  resetRange: (key) => {
    set((s) => {
      const next = { ...s.ranges };
      delete next[key];
      return { ranges: next };
    });
    const uid = currentUserId();
    if (uid) {
      deleteCustomRange(uid, key).catch(() => {});
    } else {
      const port = localPort<CustomRanges>(STORAGE_KEY, {});
      port.save(get().ranges).catch(() => {});
    }
  },

  resetAll: () => {
    set({ ranges: {} });
    const uid = currentUserId();
    if (!uid) {
      const port = localPort<CustomRanges>(STORAGE_KEY, {});
      port.save({}).catch(() => {});
    }
  },
}));
