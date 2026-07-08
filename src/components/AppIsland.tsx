import App from '../App';
import { LanguageProvider } from '../i18n';
import { ThemeProvider } from '../theme';

// The whole current SPA, mounted as one client-only island by [...all].astro.
// (Per-page SSR replaces this island page-by-page in later plans.)
export default function AppIsland() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </ThemeProvider>
  );
}

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
