import { useTicker } from '../hooks/useTicker';
import ScoresRail from './ScoresRail';

// Shares the module-level poller with the global Ticker strip, so the rail
// costs no extra scoreboard fan-out.
export default function ScoresRailIsland() {
  const { items, loading } = useTicker();
  return <ScoresRail scores={items} loading={loading} />;
}
