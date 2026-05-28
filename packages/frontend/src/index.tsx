import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import '@shopify/polaris/build/esm/styles.css';
import App from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
});

const appBridgeConfig = {
  apiKey: import.meta.env.VITE_SHOPIFY_API_KEY || '',
  host: new URLSearchParams(window.location.search).get('host') || '',
  forceRedirect: true,
};

function Root() {
  return (
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <AppProvider i18n={enTranslations}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AppProvider>
      </QueryClientProvider>
    </React.StrictMode>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found. Ensure index.html has <div id="root"></div>.');
}

ReactDOM.createRoot(rootElement).render(<Root />);
