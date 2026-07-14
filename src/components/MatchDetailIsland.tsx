import type { CompMatch } from '../types';
import type { MatchDetail } from '../adapters/types';
import { useRouter, pathFor } from '../utils/router';
import MatchDetailPage from './MatchDetailPage';
import AppProviders from './AppProviders';

export default function MatchDetailIsland({
  match,
  initialDetail,
}: {
  match: CompMatch;
  initialDetail: MatchDetail | null;
}) {
  const { route } = useRouter();
  const backHref = pathFor({ kind: 'section', comp: route.comp, section: 'matches' });

  return (
    <AppProviders>
      <MatchDetailPage match={match} backHref={backHref} initialDetail={initialDetail} />
    </AppProviders>
  );
}
