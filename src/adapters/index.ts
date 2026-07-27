import { COMPETITIONS, type Sport } from '../competitions';
import { basketballAdapter } from './basketball';
import { soccerAdapter } from './soccer';
import type { SportAdapter } from './types';

// One adapter per sport we serve. `Record<Sport, …>` (not `Partial`) is the
// point: adding a Sport to the union without an adapter is a compile error,
// which is why there is no runtime "missing adapter" branch below.
const ADAPTERS: Record<Sport, SportAdapter> = {
  soccer: soccerAdapter,
  basketball: basketballAdapter,
};

// Resolve the adapter for a competition via its registered sport — the single
// lookup shared by useCompetition and useMatchDetail.
export function getAdapter(comp: string): SportAdapter {
  if (!Object.hasOwn(COMPETITIONS, comp)) throw new Error(`Unknown competition: ${comp}`);
  return ADAPTERS[COMPETITIONS[comp].sport];
}
