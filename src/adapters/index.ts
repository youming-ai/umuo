import { COMPETITIONS, type Sport } from '../competitions';
import { basketballAdapter } from './basketball';
import { soccerAdapter } from './soccer';
import type { SportAdapter } from './types';

// One adapter per sport we serve. Keyed by Competition.sport so
// useCompetition / useMatchDetail resolve the transform from the registry
// (single source of truth, same as buildUrl).
export const ADAPTERS: Partial<Record<Sport, SportAdapter>> & {
  soccer: SportAdapter;
  basketball: SportAdapter;
} = {
  soccer: soccerAdapter,
  basketball: basketballAdapter,
};

// Resolve the adapter for a competition via its registered sport — the single
// lookup+guard shared by useCompetition and useMatchDetail.
export function getAdapter(comp: string): SportAdapter {
  const sport = COMPETITIONS[comp].sport;
  const adapter = ADAPTERS[sport];
  if (!adapter) throw new Error(`No adapter for sport: ${sport}`);
  return adapter;
}
