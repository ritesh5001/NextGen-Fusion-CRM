import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      // Revisiting a page within 30s renders instantly from cache (no refetch flash).
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      // Keep the previous results on screen while a new query (filter/page/search) loads,
      // so lists never blank out to a spinner.
      placeholderData: keepPreviousData,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
