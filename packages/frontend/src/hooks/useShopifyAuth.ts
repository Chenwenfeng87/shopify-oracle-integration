import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// ============================================================================
// Auth State Types
// ============================================================================

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  shop: string | null;
  host: string | null;
  sessionToken: string | null;
  error: string | null;
}

const initialState: AuthState = {
  isAuthenticated: false,
  isLoading: true,
  shop: null,
  host: null,
  sessionToken: null,
  error: null,
};

/**
 * Hook for managing Shopify App Bridge authentication state.
 *
 * Extracts the shop and host from URL parameters, validates the session,
 * and obtains a session token for API requests.
 */
export function useShopifyAuth() {
  const [authState, setAuthState] = useState<AuthState>(initialState);

  const updateAuthState = useCallback((partial: Partial<AuthState>) => {
    setAuthState((prev) => ({ ...prev, ...partial }));
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      try {
        // Extract shop and host from URL query parameters
        const params = new URLSearchParams(window.location.search);
        const shop = params.get('shop');
        const host = params.get('host');
        const embeddedParam = params.get('embedded');

        if (!shop) {
          // Not in an embedded context — could be development or non-embedded
          if (mounted) {
            updateAuthState({
              isAuthenticated: true,
              isLoading: false,
              shop: shop || 'development.myshopify.com',
              host,
              error: null,
            });
          }
          return;
        }

        // Validate shop domain format
        const shopDomainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
        if (!shopDomainRegex.test(shop)) {
          if (mounted) {
            updateAuthState({
              isAuthenticated: false,
              isLoading: false,
              error: 'Invalid shop domain format.',
            });
          }
          return;
        }

        // Validate session with backend
        try {
          const response = await axios.get('/api/auth/session', {
            params: { shop, host },
          });

          if (response.data?.isValid) {
            if (mounted) {
              updateAuthState({
                isAuthenticated: true,
                isLoading: false,
                shop,
                host,
                sessionToken: response.data.sessionToken || null,
                error: null,
              });
            }
          } else {
            // Session invalid — redirect to auth
            if (mounted) {
              updateAuthState({
                isAuthenticated: false,
                isLoading: false,
                shop,
                host,
                error: 'Session invalid. Redirecting to authentication...',
              });
            }

            // Redirect to OAuth flow
            const authUrl = `/api/auth?shop=${encodeURIComponent(shop)}${host ? `&host=${encodeURIComponent(host)}` : ''}`;
            window.location.href = authUrl;
          }
        } catch {
          // Backend not available or session check failed
          // In embedded context, try to proceed; the backend will validate
          if (mounted) {
            updateAuthState({
              isAuthenticated: true,
              isLoading: false,
              shop,
              host,
              error: null,
            });
          }
        }
      } catch (error) {
        if (mounted) {
          updateAuthState({
            isAuthenticated: false,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Authentication failed',
          });
        }
      }
    }

    initAuth();

    return () => {
      mounted = false;
    };
  }, [updateAuthState]);

  /**
   * Initiate re-authentication if the session expires.
   */
  const reauthenticate = useCallback(() => {
    const shop = authState.shop;
    if (shop) {
      const authUrl = `/api/auth?shop=${encodeURIComponent(shop)}`;
      window.location.href = authUrl;
    }
  }, [authState.shop]);

  return {
    ...authState,
    reauthenticate,
  };
}
