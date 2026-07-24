import type { MatchDetail } from '../adapters/types';
import type { CompMatch } from '../types';
import { pathFor, useRouter } from '../utils/router';
import MatchDetailPage from './MatchDetailPage';

export default function MatchDetailIsland({
  match,
  initialDetail,
}: {
  match: CompMatch;
  initialDetail: MatchDetail | null;
}) {
  const { route } = useRouter();
  const backHref = pathFor({ kind: 'section', comp: route.comp, section: 'schedule' });

  return <MatchDetailPage match={match} backHref={backHref} initialDetail={initialDetail} />;
}
