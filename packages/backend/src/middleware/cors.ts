import cors from 'cors';
import { config } from '../config/app.config';

/**
 * List of Shopify admin domains that should always be allowed.
 * This covers all *.myshopify.com domains as well as any custom
 * Shopify domains that merchants may use.
 */
const SHOPIFY_ADMIN_DOMAINS = [
  /\.myshopify\.com$/,
  /\.shopify\.com$/,
  /^https:\/\/admin\.shopify\.com/,
];

/**
 * Determine if the request origin is a Shopify admin domain.
 */
function isShopifyAdminDomain(origin: string): boolean {
  try {
    const url = new URL(origin);
    return SHOPIFY_ADMIN_DOMAINS.some((pattern) => pattern.test(url.hostname));
  } catch {
    return false;
  }
}

/**
 * CORS middleware configured for a Shopify embedded app.
 *
 * - Allows requests from any Shopify admin domain (*.myshopify.com)
 * - Allows the app's own frontend URL
 * - Supports credentials (cookies, session) for embedded app authentication
 * - Exposes standard headers for the Shopify App Bridge
 */
export const corsMiddleware = cors({
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    // Allow requests with no origin (server-to-server, health checks, etc.)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Allow the app's own frontend URL
    if (origin === config.frontend.url) {
      callback(null, true);
      return;
    }

    // Allow any Shopify admin domain
    if (isShopifyAdminDomain(origin)) {
      callback(null, true);
      return;
    }

    // In development, allow localhost origins
    if (config.isDevelopment) {
      try {
        const originUrl = new URL(origin);
        if (
          originUrl.hostname === 'localhost' ||
          originUrl.hostname === '127.0.0.1'
        ) {
          callback(null, true);
          return;
        }
      } catch {
        // If we can't parse the origin, deny it
      }
    }

    // Deny all other origins
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Shopify-Domain',
    'X-Shopify-Hmac-Sha256',
    'X-Shopify-Shop-Domain',
    'X-Shopify-Access-Token',
    'X-Sync-Request-Id',
  ],
  exposedHeaders: [
    'X-Request-Id',
    'X-Sync-Request-Id',
    'Retry-After',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
  ],
  maxAge: 86400, // 24 hours — preflight cache
});

export default corsMiddleware;
