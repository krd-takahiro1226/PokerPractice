import { create } from 'zustand';
import { localPort, currentUserId } from './persistence';
import { insertBookmark, deleteBookmark, fetchBookmarks } from './remote/bookmarks';

const STORAGE_KEY = 'poker-trainer-bookmarks';

type BookmarkItem = {
  problemKey: string;
  note?: string;
  createdAt: number;
};

type BookmarksState = {
  items: BookmarkItem[];
  loaded: boolean;
  toggle: (problemKey: string, note?: string) => void;
  has: (problemKey: string) => boolean;
  load: () => Promise<void>;
};

export const useBookmarks = create<BookmarksState>()((set, get) => ({
  items: [],
  loaded: false,

  toggle: (problemKey, note) => {
    const existing = get().items.find((i) => i.problemKey === problemKey);
    if (existing) {
      set((s) => ({ items: s.items.filter((i) => i.problemKey !== problemKey) }));
      const uid = currentUserId();
      if (uid) {
        deleteBookmark(uid, problemKey).catch(() => {});
      } else {
        const port = localPort<BookmarkItem[]>(STORAGE_KEY, []);
        port.load().then((items) => {
          port.save(items.filter((i) => i.problemKey !== problemKey)).catch(() => {});
        });
      }
    } else {
      const item: BookmarkItem = { problemKey, note, createdAt: Date.now() };
      set((s) => ({ items: [...s.items, item] }));
      const uid = currentUserId();
      if (uid) {
        insertBookmark(uid, item).catch(() => {});
      } else {
        const port = localPort<BookmarkItem[]>(STORAGE_KEY, []);
        port.load().then((existing) => {
          port.save([...existing, item]).catch(() => {});
        });
      }
    }
  },

  has: (problemKey) => get().items.some((i) => i.problemKey === problemKey),

  load: async () => {
    const uid = currentUserId();
    let items: BookmarkItem[] = [];
    if (uid) {
      items = await fetchBookmarks(uid);
    } else {
      const port = localPort<BookmarkItem[]>(STORAGE_KEY, []);
      items = await port.load();
    }
    set({ items, loaded: true });
  },
}));
