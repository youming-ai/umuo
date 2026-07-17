import { Bell } from 'lucide-react';
import { googleCalUrl, icsDataUri } from '../utils/calendar';

export function ReminderMenu({ title, start }: { title: string; start: Date }) {
  const event = { title, start };
  const itemCls =
    'block px-3 py-2 text-xs text-chalk hover:bg-overlay/5 whitespace-nowrap transition-colors';
  return (
    <details
      className="relative"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
    >
      <summary
        className="flex min-h-11 min-w-11 list-none cursor-pointer items-center justify-center rounded-pill hover:bg-overlay/10 ds-press"
        aria-label="Set a reminder"
        title="Set a reminder"
      >
        <Bell className="w-4 h-4" aria-hidden />
      </summary>
      <div className="absolute right-0 top-full z-10 mt-2 border border-line bg-panel shadow-float rounded-card overflow-hidden py-1">
        {/* .ics opens the OS/system calendar; download attr names the file */}
        <a href={icsDataUri(event)} download={`${title}.ics`} className={itemCls}>
          System calendar
        </a>
        <a href={googleCalUrl(event)} target="_blank" rel="noopener noreferrer" className={itemCls}>
          Google Calendar
        </a>
      </div>
    </details>
  );
}
