import { SITE_NAME } from '../site';

// Brand mark: the double "u" from the name (u·m·u·o opens and closes with one),
// set on the ink tile in the pitch accent. Pure geometry — no emoji font, no
// text metrics — so the mark is identical in the header, footer, favicon, and
// the social card, in both themes.
const MARK =
  'M5 9.25 V19.25 A3.5 3.5 0 0 0 12.5 19.25 V9.25 M19.5 9.25 V19.25 A3.5 3.5 0 0 0 27 19.25 V9.25';

export default function Logo({ compact = false }: { compact?: boolean }) {
  const size = compact ? 20 : 28;
  return (
    <a href="/" className="inline-flex items-center leading-none ds-press">
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#0a0e0c" />
        <path d={MARK} fill="none" stroke="#2ed573" strokeWidth="4.5" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{SITE_NAME} home</span>
    </a>
  );
}
