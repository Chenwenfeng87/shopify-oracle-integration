import crypto from 'crypto';
import { ShopifyClient } from './shopify-client';
import { logger } from '../../utils/logger';
import type { ShopifyWebhook, ShopifyWebhookTopic } from '@shared/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The set of webhook topics required by the integration for real-time sync.
 */
const REQUIRED_WEBHOOK_TOPICS: ShopifyWebhookTopic[] = [
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

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ShopifyWebhookService {
  constructor(private readonly client: ShopifyClient) {}

  // -------------------------------------------------------------------------
  // Webhook Management
  // -------------------------------------------------------------------------

  /**
   * Register a new webhook for the given topic and callback address.
   *
   * Shopify webhooks are registered at the store level and deliver JSON
   * payloads to the specified address when the topic event occurs.
   */
  async registerWebhook(topic: string, address: string): Promise<ShopifyWebhook> {
    logger.info('Registering Shopify webhook', { topic, address });

    const response = await this.client.post<{ webhook: ShopifyWebhook }>(
      '/webhooks.json',
      {
        webhook: {
          topic,
          address,
          format: 'json',
        },
      },
    );

    logger.info('Shopify webhook registered', {
      webhookId: response.webhook.id,
      topic: response.webhook.topic,
    });

    return response.webhook;
  }

  /**
   * Get all webhooks currently registered for the store.
   */
  async getWebhooks(): Promise<ShopifyWebhook[]> {
    const response = await this.client.get<{ webhooks: ShopifyWebhook[] }>(
      '/webhooks.json',
    );

    return response.webhooks || [];
  }

  /**
   * Delete a webhook by its ID.
   */
  async deleteWebhook(id: number): Promise<void> {
    logger.info('Deleting Shopify webhook', { webhookId: id });
    await this.client.delete(`/webhooks/${id}.json`);
  }

  /**
   * Ensure all required webhooks are registered for a given callback URL.
   * Removes any webhooks that are no longer needed.
   * This is idempotent and safe to call on app install or settings change.
   *
   * @param baseUrl - The base URL of the integration backend (e.g. "https://example.com/api/webhooks")
   * @returns The list of registered webhooks after ensuring required topics.
   */
  async ensureRequiredWebhooks(baseUrl: string): Promise<ShopifyWebhook[]> {
    const existingWebhooks = await this.getWebhooks();
    const existingByTopic = new Map<string, ShopifyWebhook>();

    for (const wh of existingWebhooks) {
      existingByTopic.set(wh.topic, wh);
    }

    const registered: ShopifyWebhook[] = [];

    // Register missing required webhooks
    for (const topic of REQUIRED_WEBHOOK_TOPICS) {
      const address = `${baseUrl.replace(/\/+$/, '')}/webhooks/${topic.replace(/\//g, '-')}`;

      const existing = existingByTopic.get(topic);
      if (existing) {
        // Check if the address is still correct; update if needed
        if (existing.address !== address) {
          logger.info('Updating webhook address', { topic, oldAddress: existing.address, newAddress: address });
          await this.deleteWebhook(existing.id);
          const created = await this.registerWebhook(topic, address);
          registered.push(created);
        } else {
          registered.push(existing);
        }
      } else {
        const created = await this.registerWebhook(topic, address);
        registered.push(created);
      }
    }

    // Remove webhooks that are no longer in our required list
    const requiredSet = new Set(REQUIRED_WEBHOOK_TOPICS);
    for (const wh of existingWebhooks) {
      if (!requiredSet.has(wh.topic as ShopifyWebhookTopic)) {
        logger.info('Removing obsolete webhook', { topic: wh.topic, webhookId: wh.id });
        await this.deleteWebhook(wh.id);
      }
    }

    return registered;
  }

  // -------------------------------------------------------------------------
  // HMAC Verification
  // -------------------------------------------------------------------------

  /**
   * Verify the HMAC signature of an incoming Shopify webhook payload.
   *
   * Shopify signs webhook payloads with the store's shared secret using
   * HMAC-SHA256. The signature is sent in the `X-Shopify-Hmac-Sha256`
   * header as a Base64-encoded string.
   *
   * @param rawBody - The raw (unparsed) JSON body string of the webhook request
   * @param hmacHeader - The value of the `X-Shopify-Hmac-Sha256` header
   * @returns `true` if the HMAC is valid, `false` otherwise
   */
  verifyWebhookHmac(rawBody: string, hmacHeader: string): boolean {
    if (!rawBody || !hmacHeader) {
      logger.warn('Webhook HMAC verification failed: missing body or header');
      return false;
    }

    try {
      // The store's shared secret is used as the HMAC key.
      // In production this should be config.SHOPIFY_API_SECRET.
      const secret = process.env.SHOPIFY_API_SECRET || '';
      if (!secret) {
        logger.error('Webhook HMAC verification failed: SHOPIFY_API_SECRET not configured');
        return false;
      }

      const computedHmac = crypto
        .createHmac('sha256', secret)
        .update(rawBody, 'utf8')
        .digest('base64');

      // Constant-time comparison to prevent timing attacks
      const provided = Buffer.from(hmacHeader);
      const computed = Buffer.from(computedHmac);

      if (provided.length !== computed.length) {
        return false;
      }

      let diff = 0;
      for (let i = 0; i < provided.length; i++) {
        diff |= provided[i] ^ computed[i];
      }

      const isValid = diff === 0;

      if (!isValid) {
        logger.warn('Webhook HMAC signature mismatch');
      }

      return isValid;
    } catch (error) {
      logger.error('Webhook HMAC verification error', {
        error: (error as Error).message,
      });
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Required Topics
  // -------------------------------------------------------------------------

  /**
   * Get the list of webhook topics required by this integration.
   */
  getRequiredTopics(): string[] {
    return [...REQUIRED_WEBHOOK_TOPICS];
  }
}

export default ShopifyWebhookService;
