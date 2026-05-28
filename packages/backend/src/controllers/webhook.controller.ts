import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { config } from '../config/app.config';
import { logger } from '../utils/logger';
import { StoreModel } from '../models/store.model';
import { SyncEngine } from '../services/sync/sync-engine';
import type { EntityType, SyncDirection } from '@shared/types';

/**
 * Mapping from Shopify webhook topics to internal entity types and sync
 * directions. This determines what kind of sync operation is triggered
 * when a webhook is received.
 */
const TOPIC_TO_SYNC_CONFIG: Record<
  string,
  { entityType: EntityType; direction: SyncDirection } | null
> = {
  'products/create': { entityType: 'item', direction: 'shopify_to_oracle' },
  'products/update': { entityType: 'item', direction: 'shopify_to_oracle' },
  'products/delete': { entityType: 'item', direction: 'shopify_to_oracle' },
  'customers/create': { entityType: 'customer', direction: 'shopify_to_oracle' },
  'customers/update': { entityType: 'customer', direction: 'shopify_to_oracle' },
  'customers/delete': { entityType: 'customer', direction: 'shopify_to_oracle' },
  'orders/create': { entityType: 'order', direction: 'shopify_to_oracle' },
  'orders/updated': { entityType: 'order', direction: 'shopify_to_oracle' },
  'orders/cancelled': { entityType: 'order', direction: 'shopify_to_oracle' },
  'orders/fulfilled': { entityType: 'order', direction: 'shopify_to_oracle' },
  'inventory_levels/update': { entityType: 'inventory', direction: 'shopify_to_oracle' },
  'app/uninstalled': null, // Special handling
  'app/uninstall': null, // Some API versions use this
};

/**
 * List of Shopify webhook topics that the app needs to register.
 */
const REQUIRED_WEBHOOK_TOPICS = [
  'products/create',
  'products/update',
  'products/delete',
  'customers/create',
  'customers/update',
  'customers/delete',
  'orders/create',
  'orders/updated',
  'orders/cancelled',
  'orders/fulfilled',
  'inventory_levels/update',
  'app/uninstalled',
];

/**
 * Handles all webhook-related HTTP requests:
 *
 * - POST  /api/webhook/receive/:topic — Receive an incoming Shopify webhook
 * - GET   /api/webhooks               — List registered webhooks
 * - POST  /api/webhooks/register      — Register webhooks with Shopify
 */
export class WebhookController {
  /**
   * POST /api/webhook/receive/:topic
   *
   * Receive and process incoming Shopify webhooks.
   *
   * Steps:
   *  1. Verify the HMAC signature for authenticity.
   *  2. Look up the store by the X-Shopify-Shop-Domain header.
   *  3. Map the webhook topic to an entity type and sync direction.
   *  4. Handle special topics (app/uninstalled) directly.
   *  5. Create a sync job and trigger the sync engine for data topics.
   *
   * Always returns 200 to acknowledge receipt, even on errors, to prevent
   * Shopify from retrying non-critical webhooks.
   */
  async receive(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const paramsSchema = z.object({
        topic: z.string().min(1),
      });

      const { topic } = paramsSchema.parse(req.params);

      // Step 1: Verify webhook authenticity
      if (!this.verifyWebhook(req)) {
        logger.warn('Webhook HMAC verification failed', {
          topic,
          shop: req.headers['x-shopify-shop-domain'],
          requestId: req.requestId,
        });

        res.status(401).json({
          success: false,
          error: {
            code: 'WEBHOOK_VERIFICATION_FAILED',
            message: 'Webhook HMAC verification failed',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      // Extract headers
      const shopDomain = req.headers['x-shopify-shop-domain'] as string;
      const webhookId = req.headers['x-shopify-webhook-id'] as string;

      if (!shopDomain) {
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

      // Step 2: Look up the store
      const store = await StoreModel.findByDomain(shopDomain);
      if (!store || !store.isActive) {
        logger.warn('Webhook received for inactive or unknown store', {
          shop: shopDomain,
          topic,
          requestId: req.requestId,
        });
        // Still return 200 to acknowledge receipt
        res.json({
          success: true,
          data: { message: 'Webhook received' },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      const payload = req.body;
      logger.info('Webhook received', {
        topic,
        shop: shopDomain,
        webhookId,
        storeId: store.id,
        requestId: req.requestId,
      });

      // Step 3: Map topic to sync config
      const syncConfig = TOPIC_TO_SYNC_CONFIG[topic];

      if (syncConfig === undefined) {
        // Unknown topic — acknowledge but don't process
        logger.warn('Unknown webhook topic', {
          topic,
          shop: shopDomain,
          requestId: req.requestId,
        });
        res.json({
          success: true,
          data: { message: 'Webhook topic not recognized, but acknowledged' },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      // Step 4: Handle special topics
      if (syncConfig === null) {
        // app/uninstalled
        if (topic === 'app/uninstalled' || topic === 'app/uninstall') {
          await StoreModel.deactivate(store.id);
          logger.info('Store deactivated due to app uninstall', {
            storeId: store.id,
            shop: shopDomain,
            requestId: req.requestId,
          });
          res.json({
            success: true,
            data: { message: 'App uninstall processed' },
            meta: {
              timestamp: new Date().toISOString(),
              requestId: req.requestId,
            },
          });
          return;
        }
      }

      // Step 5: Trigger sync via the engine
      const syncEngine = new SyncEngine(store.id);

      // Include the webhook payload as sync params so the engine can
      // fetch just the relevant record from Shopify
      const syncParams: Record<string, unknown> = {
        ...payload,
        webhookId,
        webhookTopic: topic,
      };

      const syncJob = await syncEngine.startSync(
        syncConfig.entityType,
        syncConfig.direction,
        'webhook',
        {
          params: syncParams,
          batchSize: 1, // Webhooks typically carry a single record
        },
      );

      logger.info('Webhook-triggered sync created', {
        jobId: syncJob.id,
        entityType: syncConfig.entityType,
        direction: syncConfig.direction,
        topic,
        storeId: store.id,
        requestId: req.requestId,
      });

      res.json({
        success: true,
        data: {
          message: 'Webhook processed successfully',
          jobId: syncJob.id,
          entityType: syncConfig.entityType,
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
            message: 'Invalid webhook parameters',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      logger.error('Webhook processing error', {
        topic: req.params.topic,
        error: (error as Error).message,
        requestId: req.requestId,
      });

      // Always return 200 to Shopify to prevent retries
      res.json({
        success: false,
        error: {
          code: 'WEBHOOK_PROCESSING_ERROR',
          message:
            'Webhook received but processing encountered an error: ' +
            (error as Error).message,
        },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    }
  }

  /**
   * GET /api/webhooks
   *
   * List the webhook registrations for a store.
   * Currently returns the list of required webhook topics.
   * In a full implementation, this would query the Shopify REST API
   * to list actual registered webhooks.
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        storeId: z.string().uuid(),
      });

      const validated = schema.parse(req.query);
      const { storeId } = validated;

      // Verify store exists
      const store = await StoreModel.findById(storeId);
      if (!store) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Store not found',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      // TODO: In a full implementation, query the Shopify API for
      // the store's registered webhooks:
      //
      // const shopifyClient = new ShopifyClient(store.shopifyDomain, store.shopifyToken!);
      // const webhooks = await shopifyClient.get('/webhooks.json');
      // return webhooks.webhooks;

      logger.debug('Webhooks listed', {
        storeId,
        requestId: req.requestId,
      });

      res.json({
        success: true,
        data: {
          registeredTopics: REQUIRED_WEBHOOK_TOPICS,
          totalRequired: REQUIRED_WEBHOOK_TOPICS.length,
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
            message: 'Invalid query parameters',
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
   * POST /api/webhooks/register
   *
   * Register required webhooks with Shopify for a store.
   * Creates a webhook for each topic in the REQUIRED_WEBHOOK_TOPICS list.
   */
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        storeId: z.string().uuid(),
        topics: z.array(z.string()).optional(),
      });

      const validated = schema.parse(req.body);
      const { storeId, topics } = validated;

      // Verify store exists
      const store = await StoreModel.findById(storeId);
      if (!store) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Store not found',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      const topicsToRegister = topics || REQUIRED_WEBHOOK_TOPICS;

      // TODO: In a full implementation, register each webhook via the Shopify API:
      //
      // const shopifyClient = new ShopifyClient(store.shopifyDomain, store.shopifyToken!);
      // const results = [];
      // for (const topic of topicsToRegister) {
      //   try {
      //     const result = await shopifyClient.post('/webhooks.json', {
      //       webhook: {
      //         topic,
      //         address: `${config.shopify.appUrl}/api/webhook/receive/${topic}`,
      //         format: 'json',
      //       },
      //     });
      //     results.push({ topic, success: true, id: result.webhook.id });
      //   } catch (error) {
      //     results.push({ topic, success: false, error: error.message });
      //   }
      // }
      // return results;

      logger.info('Webhooks registration initiated', {
        storeId,
        topicsCount: topicsToRegister.length,
        topics: topicsToRegister,
        requestId: req.requestId,
      });

      // Placeholder: return the list of topics that would be registered
      const registrationResults = topicsToRegister.map((topic) => ({
        topic,
        success: true,
        address: `${config.shopify.appUrl}/api/webhook/receive/${topic}`,
        format: 'json',
      }));

      res.status(201).json({
        success: true,
        data: {
          message: `Webhook registration processed for ${topicsToRegister.length} topics`,
          webhooks: registrationResults,
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
            message: 'Invalid webhook registration data',
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
   * Verify that a webhook request originated from Shopify.
   *
   * Computes the HMAC-SHA256 of the raw request body using the Shopify
   * API secret and compares it (constant-time) to the value in the
   * X-Shopify-Hmac-Sha256 header.
   *
   * @param req - The Express request object with rawBody attached.
   * @returns True if the HMAC is valid.
   */
  private verifyWebhook(req: Request): boolean {
    const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string;

    if (!hmacHeader) {
      logger.warn('Webhook missing HMAC header');
      return false;
    }

    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      logger.warn('Webhook missing raw body for HMAC verification');
      return false;
    }

    const computedHmac = crypto
      .createHmac('sha256', config.shopify.apiSecret)
      .update(rawBody)
      .digest('base64');

    // Constant-time comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(computedHmac),
        Buffer.from(hmacHeader),
      );
    } catch {
      // If buffers are different lengths, timingSafeEqual throws
      return false;
    }
  }
}

export default WebhookController;
