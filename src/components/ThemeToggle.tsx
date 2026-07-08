import AppProviders from './AppProviders';
import ThemeSwitcher from './ThemeSwitcher';

// ThemeSwitcher needs the theme + i18n context; wrap it so the header can mount
// it as a standalone island without the rest of the app tree.
export default function ThemeToggle() {
  return (
    <AppProviders>
      <ThemeSwitcher />
    </AppProviders>
  );
}
