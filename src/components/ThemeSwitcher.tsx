import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'theme';
const CYCLE: Theme[] = ['dark', 'light'];
const ICONS = { dark: Moon, light: Sun } as const;
const THEME_LABELS: Record<Theme, string> = {
  dark: 'Dark theme',
  light: 'Light theme',
};

function detectTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* private/full */
  }
  return 'dark'; // 默认 dark
}

// The only place that touches the theme: reads/persists it and mirrors it onto
// the document root. No context — nothing else consumes the theme in React
// (every other surface themes off the `[data-theme]` attribute set here).
//
// `theme` starts null so the server and the first client render agree on an
// icon-less button: this now renders inside an SSR'd `client:load` island, so
// reading localStorage during render would be a hydration mismatch. The inline
// script in Layout has already painted the right theme by then — this only
// catches the button up.
export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = detectTheme();
    setTheme(stored);
    document.documentElement.dataset.theme = stored;
  }, []);

  const cycle = () => {
    const next = CYCLE[(CYCLE.indexOf(theme ?? 'dark') + 1) % CYCLE.length]!;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private/full */
    }
    document.documentElement.dataset.theme = next;
    setTheme(next);
  };

  const Icon = theme ? ICONS[theme] : null;
  const label = theme ? THEME_LABELS[theme] : 'Theme';

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className="flex min-h-11 min-w-11 items-center justify-center rounded-pill hover:bg-overlay/10 text-chalkdim hover:text-chalk ds-press"
    >
      {Icon && <Icon className="w-5 h-5" aria-hidden />}
    </button>
  );
}
