import { ThemeProvider } from '../theme';

// Shared provider wrapper. Used by every island to ensure theme context is present.
export default function AppProviders({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
