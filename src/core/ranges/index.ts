import { RFI_SCENARIOS } from './rfi';
import type { Scenario } from './types';

export * from './types';
export * from './expand';
export { RFI_SCENARIOS };

export const ALL_SCENARIOS: Scenario[] = [...RFI_SCENARIOS];

export function getScenario(id: string): Scenario | undefined {
  return ALL_SCENARIOS.find((s) => s.id === id);
}
