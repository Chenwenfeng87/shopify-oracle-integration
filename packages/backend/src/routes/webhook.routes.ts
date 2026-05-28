import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config/app.config';
import { logger } from '../utils/logger';
import { StoreModel } from '../models/store.model';
import { SyncJobModel } from '../models/sync-job.model';

const router = Router();

/**
 * Verify that a webhook request came from Shopify.
 * Computes the HMAC from the request body and compares it to the
 * X-Shopify-Hmac-Sha256 header.
 */
function verifyWebhook(req: Request): boolean {
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

  return crypto.timingSafeEqual(
    Buffer.from(computedHmac),
    Buffer.from(hmacHeader),
  );
}

/**
 * POST /api/webhook/receive/:topic
 * Receive and process incoming Shopify webhooks.
 * Topics include: products/create, products/update, orders/create, etc.
 */
router.post('/receive/:topic', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Verify webhook authenticity
    if (!verifyWebhook(req)) {
      logger.warn('Webhook HMAC verification failed', {
        topic: req.params.topic,
        shop: req.headers['x-shopify-shop-domain'],
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

    const topic = req.params.topic;
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

    // Look up the store
    const store = await StoreModel.findByDomain(shopDomain);
    if (!store || !store.isActive) {
      logger.warn('Webhook received for inactive or unknown store', {
        shop: shopDomain,
        topic,
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
    });

    // Map webhook topics to entity types and triggers
    const topicToEntity: Record<string, string> = {
      'products/create': 'item',
      'products/update': 'item',
      'products/delete': 'item',
      'customers/create': 'customer',
      'customers/update': 'customer',
      'customers/delete': 'customer',
      'orders/create': 'order',
      'orders/updated': 'order',
      'orders/cancelled': 'order',
      'orders/fulfilled': 'order',
      'inventory_levels/update': 'inventory',
      'app/uninstalled': 'app',
    };

    const entityType = topicToEntity[topic];

    if (!entityType) {
      logger.warn('Unknown webhook topic', { topic });
      res.status(200).json({
        success: true,
        data: { message: 'Webhook topic not recognized, but acknowledged' },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
      return;
    }

    // Handle app/uninstalled specially
    if (topic === 'app/uninstalled') {
      await StoreModel.deactivate(store.id);
      logger.info('Store deactivated due to app uninstall', {
        storeId: store.id,
        shop: shopDomain,
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

    // Create a sync job for the webhook-triggered sync
    // This ensures the webhook payload gets processed by the sync engine
    const syncJob = await SyncJobModel.create({
      storeId: store.id,
      entityType: entityType as any,
      direction: 'shopify_to_oracle',
      trigger: 'webhook',
      totalRecords: 1,
    });

    logger.info('Webhook sync job created', {
      jobId: syncJob.id,
      entityType,
      topic,
      storeId: store.id,
    });

    res.json({
      success: true,
      data: {
        message: 'Webhook processed successfully',
        jobId: syncJob.id,
        entityType,
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    logger.error('Webhook processing failed', {
      topic: req.params.topic,
      error: (error as Error).message,
    });
    // Always return 200 to Shopify to prevent retries for non-critical errors
    res.status(200).json({
      success: false,
      error: {
        code: 'WEBHOOK_PROCESSING_ERROR',
        message: 'Webhook received but processing encountered an error',
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  }
});

export default router;
