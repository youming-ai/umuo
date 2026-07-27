import type { NewsItem, NewsTag } from '../types';
import { timeAgo } from '../utils/helpers';

// Shared article card for the news surfaces.
//  - 'lead'     : large hero (image + text side-by-side on md), one at the top of a feed
//  - 'row'      : compact horizontal list item (image left, text right) for a
//                 single-column feed — keeps a wide column from becoming a
//                 stack of oversized images
//  - 'standard' : image-on-top card (used in narrow/grid contexts)
export default function NewsCard({
  item,
  variant = 'standard',
}: {
  item: NewsItem;
  variant?: 'standard' | 'lead' | 'row';
}) {
  const external = item.link.startsWith('https://');
  const linked = external || item.link.startsWith('/');
  const isLead = variant === 'lead';
  const isRow = variant === 'row';
  const meta = [item.byline, timeAgo(item.published)].filter(Boolean).join(' · ');

  const body = isRow ? (
    <div className="flex items-stretch gap-3">
      {item.imageUrl && (
        <img
          src={item.imageUrl}
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
          className="aspect-video w-32 shrink-0 rounded-card-inset object-cover sm:w-44"
          loading="lazy"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col justify-center py-2.5 pr-1">
        <h3 className="font-display text-label font-semibold leading-label text-chalk line-clamp-2">
          {item.headline}
        </h3>
        {item.description && (
          <p className="mt-1 ds-body text-chalkdim line-clamp-2">{item.description}</p>
        )}
        {meta && <p className="mt-1.5 ds-caption text-chalkdim">{meta}</p>}
      </div>
    </div>
  ) : (
    <div className={isLead ? 'md:flex' : undefined}>
      {item.imageUrl && (
        <img
          src={item.imageUrl}
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
          className={`w-full object-cover rounded-card-inset ${
            isLead ? 'aspect-[16/9] md:aspect-auto md:h-full md:w-1/2' : 'aspect-video'
          }`}
          loading={isLead ? 'eager' : 'lazy'}
        />
      )}
      <div className={isLead ? 'p-4 md:flex md:w-1/2 md:flex-col md:justify-center md:p-5' : 'p-3'}>
        <h3
          className={`font-display font-semibold text-chalk leading-label ${
            isLead ? 'text-lead md:text-hero line-clamp-3' : 'text-label line-clamp-2'
          }`}
        >
          {item.headline}
        </h3>
        {item.description && (
          <p
            className={`mt-1 font-body text-chalkdim ${
              isLead ? 'ds-lead line-clamp-3' : 'ds-body line-clamp-2'
            }`}
          >
            {item.description}
          </p>
        )}
        {meta && <p className="mt-2 ds-caption text-chalkdim">{meta}</p>}
      </div>
    </div>
  );

  return (
    <article
      className={`ds-glass rounded-card shadow-panel ${isRow ? 'p-card-inner' : 'overflow-hidden'}`}
    >
      {linked ? (
        <a
          href={item.link}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          className="block rounded-card-inset hover:opacity-95 transition-opacity duration-150 ease-out"
        >
          {body}
        </a>
      ) : (
        <div className="rounded-card-inset">{body}</div>
      )}
      {/* Tags only on the fuller cards; the compact row stays a clean list.
          They sit outside the anchor so they stay non-interactive, so on the
          lead card they must track the text column by hand: with an image the
          column is the right half (ml-auto), without one it starts at the left
          edge. Get this wrong and the tags read as belonging to nothing. */}
      {!isRow && item.tags.length > 0 && (
        <div
          className={`flex flex-wrap gap-1.5 ${
            isLead
              ? `px-4 pb-4 md:w-1/2 md:px-5 md:pb-5 ${item.imageUrl ? 'md:ml-auto' : ''}`
              : 'px-3 pb-3'
          }`}
        >
          {item.tags.map((tag, i) => (
            <Tag
              // biome-ignore lint/suspicious/noArrayIndexKey: tags are deduped so index is stable
              key={`${tag.kind}:${tag.label}:${i}`}
              tag={tag}
            />
          ))}
        </div>
      )}
    </article>
  );
}

// All tags render as plain labels. News is per-competition (site.api league
// feed); there is no team-scoped news route to link into.
function Tag({ tag }: { tag: NewsTag }) {
  const cls = 'ds-caption rounded-micro px-1.5 py-0.5 bg-overlay/5';
  return <span className={`${cls} text-chalkdim`}>{tag.label}</span>;
}
