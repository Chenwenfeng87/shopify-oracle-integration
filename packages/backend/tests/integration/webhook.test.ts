// ============================================================================
// Webhook API Integration Tests
// ============================================================================

import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  mockQuery,
  createMockStore,
  createMockSyncJob,
  createTestId,
} from '../setup';

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    })),
  },
  createChildLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

function generateHmacHeaders(body: object): Record<string, string> {
  const rawBody = JSON.stringify(body);
  const hmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(rawBody)
    .digest('base64');

  return {
    'X-Shopify-Hmac-Sha256': hmac,
    'X-Shopify-Shop-Domain': 'test-store.myshopify.com',
    'X-Shopify-Webhook-Id': uuidv4(),
    'Content-Type': 'application/json',
  };
}

import webhookRoutes from '../../src/routes/webhook.routes';

const app = express();
// Need raw body capture - the webhook route relies on req.rawBody
app.use(
  express.json({
    verify: (req: any, _res: any, buf: Buffer) => {
      if (req.path.startsWith('/api/webhook/')) {
        req.rawBody = buf.toString();
      }
    },
  })
);
app.use((req: any, _res: any, next: any) => {
  req.requestId = 'test-request-id';
  next();
});
app.use('/api/webhook', webhookRoutes);

describe('Webhook API Integration', () => {
  describe('POST /api/webhook/receive/:topic', () => {
    const shopifyProductPayload = {
      id: 123456789,
      title: 'Test Product',
      vendor: 'Test Vendor',
      product_type: 'Physical',
      status: 'active',
      variants: [{ id: 987654321, sku: 'TEST-SKU-001', price: '29.99' }],
    };

    const shopifyOrderPayload = {
      id: 555666777,
      order_number: 1001,
      name: '#1001',
      email: 'customer@example.com',
      total_price: '150.00',
      currency: 'USD',
      line_items: [{ id: 1, sku: 'ITEM-001', quantity: 2, price: '75.00' }],
      financial_status: 'paid',
    };

    const shopifyCustomerPayload = {
      id: 333444555,
      email: 'john.doe@example.com',
      first_name: 'John',
      last_name: 'Doe',
      phone: '+1-555-123-4567',
      verified_email: true,
    };

    test('processes products/create webhook', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });
      const jobId = createTestId();

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({
        rows: [createMockSyncJob({ id: jobId, store_id: storeId, entity_type: 'item' })],
      });

      const res = await request(app)
        .post('/api/webhook/receive/products/create')
        .set(generateHmacHeaders(shopifyProductPayload))
        .send(shopifyProductPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.entityType).toBe('item');
      expect(res.body.data.jobId).toBeDefined();
    });

    test('processes orders/create webhook', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({
        rows: [createMockSyncJob({ store_id: storeId, entity_type: 'order' })],
      });

      const res = await request(app)
        .post('/api/webhook/receive/orders/create')
        .set(generateHmacHeaders(shopifyOrderPayload))
        .send(shopifyOrderPayload);

      expect(res.status).toBe(200);
      expect(res.body.data.entityType).toBe('order');
    });

    test('processes customers/create webhook', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({
        rows: [createMockSyncJob({ store_id: storeId, entity_type: 'customer' })],
      });

      const res = await request(app)
        .post('/api/webhook/receive/customers/create')
        .set(generateHmacHeaders(shopifyCustomerPayload))
        .send(shopifyCustomerPayload);

      expect(res.status).toBe(200);
      expect(res.body.data.entityType).toBe('customer');
    });

    test('handles app/uninstalled webhook (shop redact)', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId, is_active: true });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      // deactivate store
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/webhook/receive/app/uninstalled')
        .set(generateHmacHeaders({}))
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('App uninstall processed');

      // Should have deactivated the store
      const deactivateCall = mockQuery.mock.calls.find(
        (call: any) =>
          call[0].toLowerCase().includes('update stores') &&
          call[0].toLowerCase().includes('is_active = false')
      );
      expect(deactivateCall).toBeDefined();
    });

    test('returns 200 even for unknown webhook topics', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });

      const res = await request(app)
        .post('/api/webhook/receive/checkouts/create')
        .set(generateHmacHeaders({ some: 'data' }))
        .send({ some: 'data' });

      // Always returns 200 to Shopify
      expect(res.status).toBe(200);
      expect(res.body.data.message).toContain('acknowledged');
    });

    test('returns 401 when HMAC verification fails', async () => {
      const res = await request(app)
        .post('/api/webhook/receive/products/create')
        .set({
          'X-Shopify-Hmac-Sha256': 'invalid-hmac-value',
          'X-Shopify-Shop-Domain': 'test-store.myshopify.com',
          'Content-Type': 'application/json',
        })
        .send(shopifyProductPayload);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('WEBHOOK_VERIFICATION_FAILED');
    });

    test('always returns 200 to Shopify even on processing errors', async () => {
      // Make the store lookup throw an error
      mockQuery.mockRejectedValueOnce(new Error('Database connection lost'));

      const res = await request(app)
        .post('/api/webhook/receive/products/create')
        .set(generateHmacHeaders(shopifyProductPayload))
        .send(shopifyProductPayload);

      expect(res.status).toBe(200);
      expect(res.body.error.code).toBe('WEBHOOK_PROCESSING_ERROR');
    });

    test('returns 200 for inactive store (still acknowledges)', async () => {
      const store = createMockStore({ is_active: false });

      mockQuery.mockResolvedValueOnce({ rows: [store] });

      const res = await request(app)
        .post('/api/webhook/receive/products/create')
        .set(generateHmacHeaders(shopifyProductPayload))
        .send(shopifyProductPayload);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Webhook received');
    });

    test('maps webhook topics to correct entity types', async () => {
      const topicToExpected: Record<string, string> = {
        'products/create': 'item',
        'products/update': 'item',
        'products/delete': 'item',
        'customers/create': 'customer',
        'customers/update': 'customer',
        'orders/create': 'order',
        'orders/updated': 'order',
        'orders/cancelled': 'order',
        'orders/fulfilled': 'order',
        'inventory_levels/update': 'inventory',
      };

      for (const [topic, expectedEntity] of Object.entries(topicToExpected)) {
        const store = createMockStore({});

        mockQuery.mockResolvedValueOnce({ rows: [store] });
        mockQuery.mockResolvedValueOnce({
          rows: [createMockSyncJob({ store_id: store.id, entity_type: expectedEntity })],
        });

        const res = await request(app)
          .post(`/api/webhook/receive/${topic}`)
          .set(generateHmacHeaders({}))
          .send({});

        expect(res.status).toBe(200);
        expect(res.body.data.entityType).toBe(expectedEntity);
      }
    });
  });
});
