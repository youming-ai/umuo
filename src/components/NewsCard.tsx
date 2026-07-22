import type { NewsItem, NewsTag } from '../types';

// Shared article card for the news surfaces (per-comp NewsView + global
// HomeView). `variant='lead'` is the large hero card NewsView puts at the top
// of its feed; 'standard' is the masonry card both views use for the rest.
export default function NewsCard({
  item,
  variant = 'standard',
}: {
  item: NewsItem;
  variant?: 'standard' | 'lead';
}) {
  const external = item.link.startsWith('https://');
  const linked = external || item.link.startsWith('/');
  const isLead = variant === 'lead';
  const body = (
    <div className={isLead ? 'md:flex' : undefined}>
      {item.imageUrl && (
        <img
          src={item.imageUrl}
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
          className={`w-full object-cover ${
            isLead ? 'aspect-[16/9] md:aspect-auto md:h-full md:w-1/2' : 'aspect-video'
          }`}
          loading={isLead ? 'eager' : 'lazy'}
        />
      )}
      <div className={isLead ? 'p-4 md:flex md:w-1/2 md:flex-col md:justify-center md:p-5' : 'p-3'}>
        <h3
          className={`font-display font-semibold text-chalk leading-snug ${
            isLead ? 'text-xl line-clamp-3 md:text-2xl' : 'text-sm line-clamp-2'
          }`}
        >
          {item.headline}
        </h3>
        {item.description && (
          <p
            className={`mt-1 font-body text-chalkdim ${
              isLead ? 'text-sm line-clamp-3 md:text-base' : 'text-xs line-clamp-2'
            }`}
          >
            {item.description}
          </p>
        )}
        {item.byline && <p className="mt-2 ds-caption text-chalkdim">{item.byline}</p>}
      </div>
    </div>
  );

  return (
    <article className="ds-glass rounded-card shadow-panel overflow-hidden">
      {linked ? (
        <a
          href={item.link}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          className="block hover:opacity-95 transition-opacity duration-150 ease-out"
        >
          {body}
        </a>
      ) : (
        <div>{body}</div>
      )}
      {item.tags.length > 0 && (
        <div className="px-3 pb-3 flex flex-wrap gap-1.5">
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
  const cls = 'ds-caption rounded-micro px-1.5 py-0.5 bg-white/5';
  return <span className={`${cls} text-chalkdim`}>{tag.label}</span>;
}
