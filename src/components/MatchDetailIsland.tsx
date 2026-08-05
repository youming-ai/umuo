import type { MatchDetail } from '../adapters/types';
import type { CompMatch } from '../types';
import { pathFor } from '../utils/router';
import MatchDetailPage from './MatchDetailPage';

export default function MatchDetailIsland({
  comp,
  match,
  initialDetail,
}: {
  comp: string;
  match: CompMatch;
  initialDetail: MatchDetail | null;
}) {
  const backHref = pathFor({ kind: 'section', comp, section: 'schedule' });

  return (
    <MatchDetailPage comp={comp} match={match} backHref={backHref} initialDetail={initialDetail} />
  );
}
