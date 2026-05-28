import rateLimit from 'express-rate-limit';
import { Request } from 'express';

/**
 * Extract a consistent rate limit key from the request.
 * Prefers the store ID (set by auth middleware), then the Shopify domain header,
 * then the IP address as a fallback.
 */
function keyGenerator(req: Request): string {
  if (req.storeId) {
    return `store:${req.storeId}`;
  }

  const shopifyDomain = req.headers['x-shopify-shop-domain'] as string | undefined;
  if (shopifyDomain) {
    return `shop:${shopifyDomain}`;
  }

  return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
}

/**
 * Strict rate limit for authentication endpoints.
 * Limits: 20 requests per minute per store/IP.
 */
export const authRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many authentication requests. Please try again later.',
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: _req.requestId,
      },
    });
  },
  skip: (req) => req.path === '/health', // Don't rate limit health checks
});

/**
 * Moderate rate limit for sync operation endpoints.
 * Limits: 60 requests per minute per store/IP.
 */
export const syncRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Sync rate limit exceeded. Please reduce sync frequency.',
        details: {
          retryAfter: Math.ceil(res.getHeaders()['retry-after'] as number) || 60,
        },
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: _req.requestId,
      },
    });
  },
});

/**
 * General rate limit for all other endpoints.
 * Limits: 300 requests per minute per store/IP.
 */
export const generalRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: _req.requestId,
      },
    });
  },
});

export default {
  authRateLimit,
  syncRateLimit,
  generalRateLimit,
};
