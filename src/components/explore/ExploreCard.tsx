import type { ExploreArticle } from '../../types';

/** UTC-only so the SSR string and the hydrated string always match. */
function publishedDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const d = new Date(timestamp);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
}

function typeLabel(value: string): string {
  return value.replaceAll('-', ' ');
}

function scoreValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Thin meter carrying the AI quality score. Inline in a row, top edge on a card. */
function Signal({ score }: { score: number }) {
  return (
    <span className="hidden h-0.5 w-8 shrink-0 bg-line sm:block" aria-hidden="true">
      <span className="block h-full bg-pitch" style={{ width: `${score}%` }} />
    </span>
  );
}

export default function ExploreCard({
  article,
  variant = 'grid',
}: {
  article: ExploreArticle;
  variant?: 'grid' | 'list';
}) {
  const date = publishedDate(article.publishedAt);
  const score = scoreValue(article.qualityScore);
  const domain = article.sourceDomain || article.sourceName || 'football source';
  const description = article.summary || article.blurb || article.description;

  if (variant === 'list') {
    return (
      <li>
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-baseline gap-3 px-3 py-2 hover:bg-overlay/5"
        >
          <span className="ds-caption hidden w-44 shrink-0 truncate text-pitch sm:block">
            <span aria-hidden="true">&gt;_ </span>
            {domain}
          </span>
          <span className="min-w-0 flex-1 truncate font-display text-body text-chalk">
            {article.title}
          </span>
          <span className="ds-caption hidden shrink-0 uppercase tracking-data text-chalkdim lg:block">
            {typeLabel(article.articleType)}
          </span>
          <Signal score={score} />
          <span className="ds-caption shrink-0 tabular-nums text-chalkdim">{date}</span>
          <span className="sr-only">AI signal {score} of 100</span>
        </a>
      </li>
    );
  }

  return (
    <article
      className="ds-signal mb-3 overflow-hidden break-inside-avoid rounded-card border border-line/40 bg-panel/70"
      style={{ '--signal': `${score}%` } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 border-b border-line/40 px-3 py-1.5 ds-caption text-pitch">
        <span aria-hidden="true">&gt;_</span>
        <span className="truncate">{domain}</span>
      </div>

      <a href={article.url} target="_blank" rel="noopener noreferrer" className="group block">
        {article.imageUrl && (
          // Natural aspect, not cropped — the ragged card heights are what makes
          // the masonry columns read as a board rather than a grid.
          <img
            src={article.imageUrl}
            alt=""
            className="w-full"
            loading="lazy"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        )}
        <div className="p-3">
          <h2 className="font-display text-lead font-bold leading-lead text-chalk transition-colors duration-150 group-hover:text-pitch">
            {article.title}
          </h2>
          {description && (
            <p className="mt-1.5 ds-body line-clamp-5 text-chalkdim">{description}</p>
          )}

          <p className="mt-3 ds-caption uppercase tracking-data text-pitch">
            {typeLabel(article.articleType)}
            {article.competition && <span className="text-chalkdim"> / {article.competition}</span>}
            {article.tags.length > 0 && (
              <span className="text-chalkdim"> · {article.tags.slice(0, 3).join(', ')}</span>
            )}
          </p>
          <p className="mt-1 flex items-center gap-2 ds-caption text-chalkdim">
            <span className="truncate">{article.sourceName || domain}</span>
            <span className="ml-auto shrink-0 tabular-nums">{date}</span>
            <span className="sr-only">AI signal {score} of 100</span>
          </p>
        </div>
      </a>
    </article>
  );
}
