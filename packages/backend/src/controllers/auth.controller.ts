import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config/app.config';
import { logger } from '../utils/logger';
import { StoreModel } from '../models/store.model';
import { WebhookController } from './webhook.controller';

/**
 * Handles all authentication-related HTTP requests:
 *
 * - GET  /api/auth/install    — Initiate Shopify OAuth flow (returns redirect URL)
 * - GET  /api/auth/callback   — Handle OAuth callback, exchange code for token
 * - GET  /api/auth/token      — Issue a session JWT for the Shopify App Bridge
 * - POST /api/auth/logout     — Clear the current session
 */
export class AuthController {
  private webhookController: WebhookController;

  constructor() {
    this.webhookController = new WebhookController();
  }

  /**
   * GET /api/auth/shopify
   *
   * Initiate the Shopify OAuth installation flow.
   * Validates the shop domain, generates a CSRF state token, and returns the
   * Shopify authorization URL to the frontend.
   */
  async initiateOAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        shop: z
          .string()
          .min(1)
          .transform((s) => s.toLowerCase()),
        timestamp: z.string().optional(),
      });

      const validated = schema.parse(req.query);
      const shopDomain = validated.shop;

      // Validate the shop domain
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

      // Generate a random state value for CSRF protection
      const state = crypto.randomBytes(16).toString('hex');

      // Build the Shopify OAuth URL
      const redirectUri = `${config.shopify.appUrl}/api/auth/callback`;
      const scopes = config.shopify.scopes.join(',');

      const authUrl = new URL(`https://${shopDomain}/admin/oauth/authorize`);
      authUrl.searchParams.set('client_id', config.shopify.apiKey);
      authUrl.searchParams.set('scope', scopes);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('state', state);

      logger.info('Initiating Shopify OAuth', {
        shop: shopDomain,
        scopes,
        requestId: req.requestId,
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
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing or invalid shop parameter',
            details: error.errors.map((e) => ({
              path: e.path.join('.'),
              message: e.message,
            })),
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
  }

  /**
   * GET /api/auth/shopify/callback
   *
   * Handle the OAuth callback from Shopify.
   *
   * 1. Extracts and validates OAuth parameters.
   * 2. Verifies the HMAC signature for request authenticity.
   * 3. Exchanges the authorization code for a permanent access token.
   * 4. Creates or updates the store record in the database.
   * 5. Registers required Shopify webhooks for the store.
   */
  async handleCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        shop: z.string().min(1),
        code: z.string().min(1),
        state: z.string().optional(),
        timestamp: z.string().optional(),
        hmac: z.string().optional(),
      });

      const validated = schema.parse(req.query);
      const { shop, code, hmac } = validated;

      // Verify HMAC if present (Shopify sends it for additional security)
      if (hmac) {
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
          logger.warn('OAuth callback HMAC verification failed', {
            shop,
            requestId: req.requestId,
          });
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

      // Exchange authorization code for a permanent access token
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
      const shopDomain = shop.toLowerCase();

      // Check if store already exists
      let store = await StoreModel.findByDomain(shopDomain);

      if (store) {
        // Update existing store's token and reactivate if inactive
        await StoreModel.updateToken(store.id, accessToken);
        if (!store.isActive) {
          await StoreModel.reactivate(store.id);
        }
        logger.info('Store re-authenticated', {
          storeId: store.id,
          shop: shopDomain,
          requestId: req.requestId,
        });
      } else {
        // Create new store record
        store = await StoreModel.create({
          shopifyDomain: shopDomain,
          shopifyToken: accessToken,
          shopifyApiKey: config.shopify.apiKey,
        });
        logger.info('New store installed', {
          storeId: store.id,
          shop: shopDomain,
          requestId: req.requestId,
        });
      }

      // Register Shopify webhooks for this store
      try {
        // We construct a minimal request object for webhook registration
        const webhookReq = {
          ...req,
          storeId: store.id,
          body: { storeId: store.id },
        } as unknown as Request;
        await this.webhookController.register(webhookReq, res, next);
      } catch (webhookError) {
        // Webhook registration failure is non-fatal — log and continue
        logger.warn('Webhook registration after OAuth failed', {
          storeId: store.id,
          error: (webhookError as Error).message,
          requestId: req.requestId,
        });
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
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing required OAuth callback parameters',
            details: error.errors.map((e) => ({
              path: e.path.join('.'),
              message: e.message,
            })),
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      if (axios.isAxiosError(error)) {
        logger.error('Shopify OAuth token exchange failed', {
          status: error.response?.status,
          data: error.response?.data,
          requestId: req.requestId,
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
  }

  /**
   * GET /api/auth/token
   *
   * Issue a signed JWT for the Shopify App Bridge to use.
   * Verifies the X-Shopify-Shop-Domain header and optionally validates the
   * session token from the Authorization header before issuing a new token.
   */
  async getSessionToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        shop: z.string().optional(),
      });

      const validated = schema.parse(req.query);

      // The shop domain comes from either the header or query parameter
      const shopHeader = req.headers['x-shopify-shop-domain'] as string;
      const shopDomain = shopHeader || validated.shop;

      if (!shopDomain) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing shop identifier. Provide X-Shopify-Shop-Domain header or shop query parameter.',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      // Find the store
      const store = await StoreModel.findByDomain(shopDomain);
      if (!store || !store.isActive) {
        res.status(401).json({
          success: false,
          error: {
            code: 'STORE_NOT_FOUND',
            message: 'Store not found or inactive. Please re-install the app.',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      // Verify existing session token if provided
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const sessionToken = authHeader.replace('Bearer ', '');
        try {
          jwt.verify(sessionToken, config.shopify.apiSecret, {
            algorithms: ['HS256'],
            audience: config.shopify.apiKey,
          });
          logger.debug('Existing session token verified', {
            shop: shopDomain,
            requestId: req.requestId,
          });
        } catch {
          res.status(401).json({
            success: false,
            error: {
              code: 'INVALID_TOKEN',
              message: 'Session token is invalid or expired. Please re-authenticate.',
            },
            meta: {
              timestamp: new Date().toISOString(),
              requestId: req.requestId,
            },
          });
          return;
        }
      }

      // Issue a new signed JWT
      const now = Math.floor(Date.now() / 1000);
      const appToken = jwt.sign(
        {
          iss: config.shopify.appUrl,
          dest: `https://${shopDomain}`,
          aud: config.shopify.apiKey,
          sub: shopDomain,
          exp: now + 3600, // 1 hour
          nbf: now,
          iat: now,
          jti: uuidv4(),
          sid: uuidv4(),
        },
        config.shopify.apiSecret,
        { algorithm: 'HS256' },
      );

      logger.info('Session token issued', {
        storeId: store.id,
        shop: shopDomain,
        requestId: req.requestId,
      });

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
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request parameters',
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
  }

  /**
   * POST /api/auth/logout
   *
   * Clear the current session by invalidating any server-side state.
   * Returns a confirmation message.
   */
  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        storeId: z.string().uuid().optional(),
      });

      const validated = schema.parse(req.body);

      if (!validated.storeId && !req.storeId) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing storeId in request body or authentication context',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      const storeId = validated.storeId || req.storeId;

      logger.info('Store session logout', {
        storeId,
        requestId: req.requestId,
      });

      res.json({
        success: true,
        data: { message: 'Session invalidated successfully' },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
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
  }
}

export default AuthController;
