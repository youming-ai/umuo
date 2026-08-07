/** Brand wordmark — plain "umuo", the trailing "o" in pitch green. React (not
    .astro) so the Astro shells and the Explore island share one copy; rendered
    without a client directive it is static HTML. */
export default function Logo({ compact = false }: { compact?: boolean }) {
  const mark = (
    <>
      umu<span className="text-pitch">o</span>
    </>
  );
  return compact ? (
    <span className="font-display font-bold tracking-display text-chalkdim">{mark}</span>
  ) : (
    <a
      href="/"
      aria-label="umuo home"
      className="shrink-0 font-display text-xl font-bold tracking-display text-chalk"
    >
      {mark}
    </a>
  );
}
