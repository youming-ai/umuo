import { SITE_NAME } from '../site';

export default function Logo({ compact = false }: { compact?: boolean }) {
  const textSize = compact ? 'text-base' : 'text-xl';
  const emojiSize = compact ? 'text-lg' : 'text-2xl';
  return (
    <a
      href="/"
      aria-label={`${SITE_NAME} home`}
      className={`inline-flex items-center gap-2 ${textSize} font-display font-bold tracking-display text-chalkdim leading-none`}
    >
      <span aria-hidden="true" className={emojiSize}>
        ⌨️
      </span>
      <span>{SITE_NAME}</span>
    </a>
  );
}
