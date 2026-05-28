import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { config } from '../config/app.config';
import { logger } from '../utils/logger';
import { StoreModel } from '../models/store.model';
import { authRateLimit } from '../middleware/rate-limit';

const router = Router();

/**
 * GET /api/auth/install
 * Initiate Shopify OAuth installation flow.
 * Redirects the merchant to Shopify's authorization page.
 */
router.get('/install', authRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { shop, timestamp } = req.query;

    if (!shop || typeof shop !== 'string') {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required query parameter: shop',
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
      return;
    }

    // Validate the shop domain
    const shopDomain = shop.toLowerCase();
    if (!shopDomain.endsWith('.myshopify.com')) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid shop domain. Must be a valid .myshopify.com domain.',
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
      return;
    }

    // Generate a random state for CSRF protection
    const state = crypto.randomBytes(16).toString('hex');

    // Build the Shopify OAuth URL
    const redirectUri = `${config.shopify.appUrl}/api/auth/callback`;
    const scopes = config.shopify.scopes.join(',');

    const authUrl = new URL(`https://${shopDomain}/admin/oauth/authorize`);
    authUrl.searchParams.set('client_id', config.shopify.apiKey);
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);

    logger.info('Redirecting to Shopify OAuth', {
      shop: shopDomain,
      scopes,
    });

    res.json({
      success: true,
      data: {
        authUrl: authUrl.toString(),
        state,
        shop: shopDomain,
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/callback
 * Handle the OAuth callback from Shopify.
 * Exchanges the authorization code for a permanent access token.
 */
router.get('/callback', authRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { shop, code, state, timestamp, hmac } = req.query;

    if (!shop || typeof shop !== 'string' || !code || typeof code !== 'string') {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required OAuth parameters',
          details: { requiredParams: ['shop', 'code'] },
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
      return;
    }

    // Verify HMAC if present (Shopify sends it for additional security)
    if (hmac && typeof hmac === 'string') {
      const queryParams = { ...req.query } as Record<string, string>;
      delete queryParams.hmac;

      const sortedParams = Object.keys(queryParams)
        .sort()
        .map((key) => `${key}=${queryParams[key]}`)
        .join('&');

      const calculatedHmac = crypto
        .createHmac('sha256', config.shopify.apiSecret)
        .update(sortedParams)
        .digest('hex');

      if (calculatedHmac !== hmac) {
        res.status(401).json({
          success: false,
          error: {
            code: 'WEBHOOK_VERIFICATION_FAILED',
            message: 'HMAC verification failed. Request may be spoofed.',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
    }

    // Exchange the authorization code for a permanent access token
    const tokenResponse = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id: config.shopify.apiKey,
        client_secret: config.shopify.apiSecret,
        code,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 10000,
      },
    );

    const accessToken = tokenResponse.data.access_token;
    const shopDomain = shop as string;

    // Check if store already exists
    let store = await StoreModel.findByDomain(shopDomain);

    if (store) {
      // Update existing store's token and reactivate if inactive
      await StoreModel.updateToken(store.id, accessToken);
      if (!store.isActive) {
        await StoreModel.reactivate(store.id);
      }
      logger.info('Store re-authenticated', { storeId: store.id, shop: shopDomain });
    } else {
      // Create new store record
      store = await StoreModel.create({
        shopifyDomain: shopDomain,
        shopifyToken: accessToken,
        shopifyApiKey: config.shopify.apiKey,
      });
      logger.info('New store installed', { storeId: store.id, shop: shopDomain });
    }

    res.json({
      success: true,
      data: {
        store: {
          id: store.id,
          shopifyDomain: store.shopifyDomain,
          isActive: store.isActive,
        },
        token: accessToken,
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('Shopify OAuth token exchange failed', {
        status: error.response?.status,
        data: error.response?.data,
      });
      res.status(502).json({
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Failed to exchange authorization code with Shopify',
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
      return;
    }
    next(error);
  }
});

/**
 * GET /api/auth/token
 * Exchange a session token for a signed JWT.
 * Used by the Shopify App Bridge to authenticate the frontend.
 */
router.get('/token', authRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shopHeader = req.headers['x-shopify-shop-domain'] as string;
    const sessionToken = req.headers['authorization']?.replace('Bearer ', '');

    if (!shopHeader) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing X-Shopify-Shop-Domain header',
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
      return;
    }

    const store = await StoreModel.findByDomain(shopHeader);
    if (!store || !store.isActive) {
      res.status(401).json({
        success: false,
        error: {
          code: 'STORE_NOT_FOUND',
          message: 'Store not found or inactive',
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
      return;
    }

    // If a session token was provided, verify it
    if (sessionToken) {
      try {
        const decoded = jwt.verify(sessionToken, config.shopify.apiSecret, {
          algorithms: ['HS256'],
          audience: config.shopify.apiKey,
        }) as Record<string, unknown>;

        logger.debug('Session token verified', { shop: shopHeader });
      } catch {
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN',
            message: 'Session token is invalid or expired',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
    }

    // Issue a new signed JWT for the frontend
    const now = Math.floor(Date.now() / 1000);
    const appToken = jwt.sign(
      {
        iss: config.shopify.appUrl,
        dest: `https://${shopHeader}`,
        aud: config.shopify.apiKey,
        sub: shopHeader,
        exp: now + 3600, // 1 hour
        nbf: now,
        iat: now,
        jti: uuidv4(),
        sid: uuidv4(),
      },
      config.shopify.apiSecret,
      { algorithm: 'HS256' },
    );

    res.json({
      success: true,
      data: {
        token: appToken,
        store: {
          id: store.id,
          shopifyDomain: store.shopifyDomain,
        },
        expiresAt: new Date((now + 3600) * 1000).toISOString(),
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/logout
 * Invalidate the current session.
 */
router.post('/logout', authRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { storeId } = req.body;

    if (!storeId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing storeId in request body',
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
      return;
    }

    logger.info('Store logged out', { storeId });

    res.json({
      success: true,
      data: { message: 'Session invalidated successfully' },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
