import { LanguageProvider } from '../i18n';
import { ThemeProvider } from '../theme';

// Shared provider wrapper. Used by every island to ensure i18n and theme
// context is present (previously provided by AppIsland via the catch-all).
export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <LanguageProvider>
        {children}
      </LanguageProvider>
    </ThemeProvider>
  );
}
