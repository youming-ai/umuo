import { useEffect, useState } from 'react';

// Kickoff times are the one thing that cannot render identically on both sides:
// the Worker has no viewer timezone or locale, the browser has both. Server
// output and hydration output must match exactly, so SSR renders in UTC and this
// re-formats for the viewer once mounted.
//
// suppressHydrationWarning covers the single frame where the two differ; the
// `datetime` attribute carries the unambiguous instant for machines regardless.
export default function LocalTime({
  date,
  options,
  locale,
  className,
}: {
  date: Date;
  options: Intl.DateTimeFormatOptions;
  /** Pin a locale (e.g. 'en-US'); omit to follow the viewer's. */
  locale?: string;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <time dateTime={date.toISOString()} className={className} suppressHydrationWarning>
      {date.toLocaleString(locale, mounted ? options : { ...options, timeZone: 'UTC' })}
    </time>
  );
}
