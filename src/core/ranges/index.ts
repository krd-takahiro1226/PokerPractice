import { RFI_SCENARIOS, getRfiScenarios, getRfiRange } from './rfi';
import type { GameMode } from './mode';
import type { Scenario } from './types';

export * from './types';
export * from './expand';
export * from './mode';
export * from './yokosawa';
export * from './vsOpen';
export * from './seats';
export * from './effective';
export { RFI_SCENARIOS, getRfiScenarios, getRfiRange };

export const ALL_SCENARIOS: Scenario[] = [...RFI_SCENARIOS]; // tournament 既定（後方互換）

/** id で scenario を取得（既定モード tournament）。後方互換のため残す。 */
export function getScenario(id: string): Scenario | undefined {
  return ALL_SCENARIOS.find((s) => s.id === id);
}

/** モード指定で scenario を取得。 */
export function getScenarioForMode(id: string, mode: GameMode): Scenario | undefined {
  return getRfiScenarios(mode).find((s) => s.id === id);
}
