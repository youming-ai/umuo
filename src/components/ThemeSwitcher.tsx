import { Moon, Sun } from 'lucide-react';
import { type Theme, useTheme } from '../theme';

const CYCLE: Theme[] = ['dark', 'light'];

const ICONS = {
  dark: Moon,
  light: Sun,
} as const;

const THEME_LABELS: Record<Theme, string> = {
  dark: 'Dark theme',
  light: 'Light theme',
};

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const Icon = ICONS[theme];
  const label = THEME_LABELS[theme];

  const cycle = () => {
    const idx = CYCLE.indexOf(theme);
    setTheme(CYCLE[(idx + 1) % CYCLE.length]);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className="flex min-h-11 min-w-11 items-center justify-center rounded-pill hover:bg-overlay/10 text-chalkdim hover:text-chalk ds-press"
    >
      <Icon className="w-5 h-5" aria-hidden />
    </button>
  );
}
