/**
 * React Query Provider
 * Provides QueryClient context to the app
 */

import React, { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Platform } from 'react-native';

import { createQueryClient } from '../api/query-client';

// Create query client instance
const queryClient = createQueryClient();

interface QueryProviderProps {
  children: ReactNode;
  client?: QueryClient;
}

export function QueryProvider({ children, client = queryClient }: QueryProviderProps) {
  return (
    <QueryClientProvider client={client}>
      {children}
      {/* Enable React Query DevTools in development */}
      {__DEV__ && Platform.OS === 'web' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}

export { queryClient };
export default QueryProvider;