import { ThemeProvider } from '../theme';
import ThemeSwitcher from './ThemeSwitcher';

// The one place that needs theme context: ThemeSwitcher reads/sets the theme.
// Every other island themes purely off the global [data-theme] attribute the
// inline script in Layout.astro sets before hydration, so they need no provider.
export default function ThemeToggle() {
  return (
    <ThemeProvider>
      <ThemeSwitcher />
    </ThemeProvider>
  );
}
