import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/app.config';
import { logger } from '../utils/logger';

/**
 * Routes that do not require Shopify JWT authentication.
 * These are typically OAuth callback routes, webhook receivers, and GDPR endpoints.
 */
const PUBLIC_ROUTES = [
  /^\/api\/auth\/callback$/,
  /^\/api\/auth\/install$/,
  /^\/api\/webhook\/receive/,
  /^\/api\/gdpr\/customers\/data_request$/,
  /^\/api\/gdpr\/customers\/redact$/,
  /^\/api\/gdpr\/shop\/redact$/,
  /^\/health$/,
];

/**
 * Routes that are served over GET but still require valid session.
 * Includes the main app entry point and any OAuth initiation.
 */
const SESSION_REQUIRED_GET_ROUTES = [/^\/api\/auth\/$/];

/**
 * Check if a given path matches any of the public route patterns.
 */
function isPublicRoute(path: string): boolean {
  return PUBLIC_ROUTES.some((pattern) => pattern.test(path));
}

/**
 * Extended JWT payload for Shopify session tokens.
 */
interface ShopifySessionTokenPayload {
  iss: string; // Issuer — the shop's domain (e.g., https://test-shop.myshopify.com/admin)
  dest: string; // Destination — the shop's domain (e.g., https://test-shop.myshopify.com)
  aud: string; // Audience — the app's API key
  sub: string; // Subject — the shop's domain without protocol
  exp: number; // Expiration timestamp
  nbf: number; // Not before timestamp
  iat: number; // Issued at timestamp
  jti: string; // JWT ID — unique token identifier
  sid: string; // Session ID — the Shopify session ID
}

/**
 * Shopify JWT verification middleware.
 *
 * Extracts the Bearer token from the Authorization header,
 * verifies it using the Shopify API secret, and attaches
 * the storeId and shopifyDomain to the request object.
 *
 * The middleware skips authentication for:
 * - Auth callback and install routes
 * - Webhook receive routes
 * - GDPR routes
 * - Health check endpoint
 */
export function shopifyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Skip auth for public routes
  if (isPublicRoute(req.path)) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      success: false,
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Authorization header is required',
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
    return;
  }

  // Extract Bearer token
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_AUTH_FORMAT',
        message: 'Authorization header must be in the format: Bearer <token>',
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
    return;
  }

  const token = parts[1];

  try {
    // Verify the JWT using the Shopify API secret
    const decoded = jwt.verify(
      token,
      config.shopify.apiSecret,
      {
        algorithms: ['HS256'],
        audience: config.shopify.apiKey,
      },
    ) as ShopifySessionTokenPayload;

    // Extract the store domain from the destination claim
    const destUrl = new URL(decoded.dest);
    const shopifyDomain = destUrl.hostname;

    // Attach store info to the request
    req.storeId = shopifyDomain.replace(/\.myshopify\.com$/, '');
    req.shopifyDomain = shopifyDomain;

    if (req.log) {
      req.log.debug('Shopify JWT verified', {
        storeId: req.storeId,
        shopifyDomain,
        expiresAt: new Date(decoded.exp * 1000).toISOString(),
      });
    }

    next();
  } catch (error) {
    const err = error as Error;

    if (err.name === 'TokenExpiredError') {
      res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Session token has expired. Please re-authenticate.',
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
      return;
    }

    if (err.name === 'JsonWebTokenError') {
      res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Session token is invalid or malformed.',
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
      return;
    }

    logger.error('Unexpected JWT verification error', {
      error: err.message,
      path: req.path,
      requestId: req.requestId,
    });

    res.status(401).json({
      success: false,
      error: {
        code: 'AUTH_FAILED',
        message: 'Authentication failed due to an unexpected error.',
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  }
}

export default shopifyAuth;
