import { SITE_NAME } from '../site';

// Icon-only wordmark: the site name was dropped from the header, so the brand
// lives in a visually-hidden span (real text, not aria-label — Biome a11y
// prefers link content over aria).
export default function Logo({ compact = false }: { compact?: boolean }) {
  const emojiSize = compact ? 'text-lg' : 'text-2xl';
  return (
    <a
      href="/"
      className={`inline-flex items-center rounded-pill leading-none ${emojiSize} ds-press`}
    >
      <span aria-hidden="true">🤖</span>
      <span className="sr-only">{SITE_NAME} home</span>
    </a>
  );
}
