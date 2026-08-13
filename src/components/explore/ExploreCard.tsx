import { useEffect, useRef, useState } from 'react';
import { articlePath } from '../../site';
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

/** Accent for a 0–100 signal. The top strip is AI quality, the bottom
 *  strip is freshness — same colour language reads across both. */
function signalAccent(score: number): 'pitch' | 'amber' | 'live' {
  if (score >= 75) return 'pitch';
  if (score >= 45) return 'amber';
  return 'live';
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

  // Engage the shimmer only when the image is genuinely still loading at
  // hydration — cached / already-complete images stay visible and never flash.
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  useEffect(() => {
    const img = imgRef.current;
    if (img && !img.complete) setImgLoading(true);
  }, []);
  const showShimmer = imgLoading && !imgLoaded;

  if (variant === 'list') {
    return (
      <li>
        <a
          href={articlePath(article.id)}
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
          <span
            aria-hidden="true"
            className="hidden h-2 w-2 shrink-0 rounded-pill sm:inline-block"
            style={{ backgroundColor: `rgb(var(--c-${signalAccent(score)}))` }}
          />
          <span className="ds-caption shrink-0 tabular-nums text-chalkdim">{date}</span>
          <span className="sr-only">
            AI signal {score} of 100, published {date}
          </span>
        </a>
      </li>
    );
  }

  const accent = signalAccent(score);
  const freshness = scoreValue(article.freshnessScore);
  return (
    <article
      className="ds-signal contain-layout mb-3 overflow-hidden break-inside-avoid rounded-card border border-line/40 bg-panel/70"
      style={
        {
          '--signal': `${score}%`,
          '--signal-accent': `var(--c-${accent})`,
          '--fresh': `${freshness}%`,
        } as React.CSSProperties
      }
    >
      <div className="flex items-center gap-2 border-b border-line/40 px-3 py-1.5 ds-caption text-pitch">
        <span aria-hidden="true">&gt;_</span>
        <span className="truncate">{domain}</span>
      </div>

      <a href={articlePath(article.id)} className="group block">
        {article.imageUrl && (
          // Reserve aspect-ratio so the column doesn't shift when the image
          // loads. Natural ratio when the feed gave width+height, else 16:9.
          // object-cover crops to fill; ragged card heights still come from
          // text length + presence of image.
          <div
            className={`aspect-video w-full overflow-hidden bg-overlay/5${showShimmer ? ' animate-pulse' : ''}`}
            style={
              article.imageWidth > 0 && article.imageHeight > 0
                ? { aspectRatio: `${article.imageWidth} / ${article.imageHeight}` }
                : undefined
            }
          >
            <img
              ref={imgRef}
              src={article.imageUrl}
              alt=""
              decoding="async"
              className={`h-full w-full object-cover transition-opacity duration-300${showShimmer ? ' opacity-0' : ' opacity-100'}`}
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          </div>
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
            <span className="sr-only">
              AI signal {score} of 100, freshness {freshness}, published {date}
            </span>
          </p>
        </div>
      </a>

      {/* Bottom freshness strip — synced to the same accent as the top signal. */}
      <span aria-hidden="true" className="block h-0.5 w-full ds-fresh">
        <span
          className="block h-full"
          style={{
            width: `${freshness}%`,
            backgroundColor: `rgb(var(--c-${accent}))`,
          }}
        />
      </span>
    </article>
  );
}
