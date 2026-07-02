import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChipDisplay } from '../lib/chips';

type DisplayPrefsState = {
  chipDisplay: ChipDisplay;
  setChipDisplay: (d: ChipDisplay) => void;
};

export const useDisplayPrefs = create<DisplayPrefsState>()(
  persist(
    (set) => ({
      chipDisplay: 'bb',
      setChipDisplay: (d) => set({ chipDisplay: d }),
    }),
    {
      name: 'poker-trainer-display',
      version: 1,
    },
  ),
);
