/** Brand mark — `⚽ umuo`, with the trailing `o` in pitch green. The brand
 *  emoji stands in for the previous wordmark; every other reference to "umuo"
 *  is plain text. Cross-platform emoji rendering is intentional. */
export default function Logo({ compact = false }: { compact?: boolean }) {
  const textSize = compact ? 'text-base' : 'text-xl';
  const emojiSize = compact ? 'text-lg' : 'text-2xl';
  return (
    <a
      href="/"
      aria-label="umuo home"
      className={`inline-flex items-center gap-2 ${textSize} font-display font-bold tracking-display text-chalkdim leading-none`}
    >
      <span aria-hidden="true" className={emojiSize}>
        ⚽
      </span>
      <span>
        umu<span className="text-pitch">o</span>
      </span>
    </a>
  );
}
