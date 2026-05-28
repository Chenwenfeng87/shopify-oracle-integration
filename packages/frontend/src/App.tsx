import React, { useCallback, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Frame, Toast, ToastProps } from '@shopify/polaris';
import { Navigation } from './components/Layout/Navigation';

export interface AppContextValue {
  showToast: (content: string, props?: Partial<ToastProps>) => void;
}

export const AppContext = React.createContext<AppContextValue>({
  showToast: () => {},
});

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [toast, setToast] = useState<{ content: string; props?: Partial<ToastProps> } | null>(null);

  const showToast = useCallback((content: string, props?: Partial<ToastProps>) => {
    setToast({ content, props });
  }, []);

  const dismissToast = useCallback(() => {
    setToast(null);
  }, []);

  const handleNavigation = useCallback(
    (path: string) => {
      navigate(path);
    },
    [navigate]
  );

  return (
    <AppContext.Provider value={{ showToast }}>
      <Frame
        navigation={<Navigation currentPath={location.pathname} onNavigate={handleNavigation} />}
      >
        <Outlet />
        {toast && (
          <Toast content={toast.content} onDismiss={dismissToast} {...toast.props} />
        )}
      </Frame>
    </AppContext.Provider>
  );
}

export default App;
