import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // supabase/functions/_shared/roomsLogic.ts は DB I/O を伴わない純粋ロジックのみ含む
    // Deno Edge Function 補助モジュール。type-only な 'npm:' import 以外は Node からも
    // そのまま import できるため、ここに含めて Vitest でユニットテストする(ON-10)。
    include: ['src/**/*.test.ts', 'supabase/functions/_shared/*.test.ts'],
  },
});
