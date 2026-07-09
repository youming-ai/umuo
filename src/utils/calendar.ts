// Calendar links for a match. Web apps can't write the system calendar directly,
// so the "system calendar" path is an .ics file — opening it hands the event to
// the OS calendar app (iOS/macOS/Android). Google Calendar is the web fallback.

export interface CalEvent {
  title: string;
  start: Date;
  durationMin?: number; // default 120
  details?: string;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

// UTC basic format: YYYYMMDDTHHMMSSZ
function toUtc(d: Date) {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function endOf(e: CalEvent) {
  return new Date(e.start.getTime() + (e.durationMin ?? 120) * 60_000);
}

export function googleCalUrl(e: CalEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${toUtc(e.start)}/${toUtc(endOf(e))}`,
  });
  if (e.details) params.set('details', e.details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function icsDataUri(e: CalEvent): string {
  const esc = (s: string) => s.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//umuo//WC2026//EN',
    'BEGIN:VEVENT',
    `UID:${toUtc(e.start)}-${encodeURIComponent(e.title)}@umuo`,
    `DTSTART:${toUtc(e.start)}`,
    `DTEND:${toUtc(endOf(e))}`,
    `SUMMARY:${esc(e.title)}`,
    ...(e.details ? [`DESCRIPTION:${esc(e.details)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
}
