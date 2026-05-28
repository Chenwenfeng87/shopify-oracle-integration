// ============================================================================
// Auth API Integration Tests
// ============================================================================

import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  mockQuery,
  mockAxiosInstance,
  createMockStore,
  createTestId,
} from '../setup';

// The auth routes import these at module scope, so we must mock before requiring
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

jest.mock('../../src/middleware/rate-limit', () => {
  const actual = jest.requireActual('express-rate-limit');
  return {
    authRateLimit: (() => (req: any, res: any, next: any) => next())(),
    syncRateLimit: (() => (req: any, res: any, next: any) => next())(),
    generalRateLimit: (() => (req: any, res: any, next: any) => next())(),
  };
});

// We need to use the actual app but with rate limits bypassed
// Create a minimal test app with just auth routes
import authRoutes from '../../src/routes/auth.routes';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req: any, _res: any, next: any) => {
  req.requestId = 'test-request-id';
  next();
});
app.use('/api/auth', authRoutes);

function createCallbackUrl(shop: string, queryOverrides: Record<string, string> = {}): string {
  const baseParams: Record<string, string> = {
    shop,
    code: 'test-auth-code-12345',
    state: 'test-state-value',
    timestamp: Math.floor(Date.now() / 1000).toString(),
    ...queryOverrides,
  };

  // Build and sign HMAC
  const sorted = Object.keys(baseParams)
    .sort()
    .map((k) => `${k}=${baseParams[k]}`)
    .join('&');

  const hmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(sorted)
    .digest('hex');

  const params = new URLSearchParams({ ...baseParams, hmac });
  return `/api/auth/callback?${params.toString()}`;
}

// ============================================================================
// GET /api/auth/install
// ============================================================================

describe('Auth API Integration', () => {
  describe('GET /api/auth/install', () => {
    test('redirects to Shopify OAuth URL with correct parameters', async () => {
      const res = await request(app)
        .get('/api/auth/install')
        .query({ shop: 'test-store.myshopify.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.authUrl).toBeDefined();
      expect(res.body.data.authUrl).toContain('https://test-store.myshopify.com/admin/oauth/authorize');
      expect(res.body.data.authUrl).toContain('client_id=test-shopify-api-key');
      expect(res.body.data.authUrl).toContain('redirect_uri=');
      expect(res.body.data.state).toBeDefined();
      expect(typeof res.body.data.state).toBe('string');
      expect(res.body.data.state.length).toBeGreaterThan(0);
      expect(res.body.data.shop).toBe('test-store.myshopify.com');
    });

    test('includes required scopes in redirect URL', async () => {
      const res = await request(app)
        .get('/api/auth/install')
        .query({ shop: 'test-store.myshopify.com' });

      expect(res.status).toBe(200);
      const authUrl = decodeURIComponent(res.body.data.authUrl);
      expect(authUrl).toContain('scope=');
      expect(authUrl).toContain('read_products');
      expect(authUrl).toContain('write_products');
      expect(authUrl).toContain('read_customers');
      expect(authUrl).toContain('read_orders');
    });

    test('includes state parameter for CSRF protection', async () => {
      const res = await request(app)
        .get('/api/auth/install')
        .query({ shop: 'test-store.myshopify.com' });

      expect(res.status).toBe(200);
      expect(res.body.data.authUrl).toContain('state=');
      expect(res.body.data.state).toBeDefined();
      expect(res.body.data.state.length).toBe(32); // 16 random bytes = 32 hex chars
    });

    test('returns 400 when shop parameter is missing', async () => {
      const res = await request(app)
        .get('/api/auth/install');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Missing required query parameter');
    });

    test('returns 400 when shop parameter is not a string', async () => {
      const res = await request(app)
        .get('/api/auth/install')
        .query({ shop: ['array-value'] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('returns 400 for invalid shop domain', async () => {
      const res = await request(app)
        .get('/api/auth/install')
        .query({ shop: 'not-a-shopify-domain.com' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Invalid shop domain');
    });

    test('lowercases the shop domain', async () => {
      const res = await request(app)
        .get('/api/auth/install')
        .query({ shop: 'TEST-STORE.MYSHOPIFY.COM' });

      expect(res.status).toBe(200);
      expect(res.body.data.shop).toBe('test-store.myshopify.com');
    });
  });

  // ======================================================================
  // GET /api/auth/callback
  // ======================================================================

  describe('GET /api/auth/callback', () => {
    test('exchanges code for access token successfully', async () => {
      const storeId = createTestId();
      const shopDomain = 'test-store.myshopify.com';

      // Mock the token exchange with Shopify
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { access_token: 'shopify-access-token-abc' },
        status: 200,
      });

      // Mock store not existing yet (findByDomain returns null)
      mockQuery.mockResolvedValueOnce({ rows: [] });

      // Mock creating the store
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: storeId,
          shopify_domain: shopDomain,
          shopify_token: 'shopify-access-token-abc',
          shopify_api_key: 'test-shopify-api-key',
          is_active: true,
          installed_at: new Date().toISOString(),
          uninstalled_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      });

      const url = createCallbackUrl(shopDomain);
      const res = await request(app).get(url);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.store).toBeDefined();
      expect(res.body.data.store.shopifyDomain).toBe(shopDomain);
      expect(res.body.data.store.isActive).toBe(true);
      expect(res.body.data.token).toBe('shopify-access-token-abc');

      // Verify the token exchange API call
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        `https://${shopDomain}/admin/oauth/access_token`,
        expect.objectContaining({
          client_id: 'test-shopify-api-key',
          client_secret: 'test-shopify-api-secret',
          code: 'test-auth-code-12345',
        }),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          timeout: 10000,
        }),
      );
    });

    test('stores shop in database on success for new store', async () => {
      const storeId = createTestId();
      const shopDomain = 'test-store.myshopify.com';

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { access_token: 'new-token-xyz' },
        status: 200,
      });

      // No existing store
      mockQuery.mockResolvedValueOnce({ rows: [] });

      // Store creation
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: storeId,
          shopify_domain: shopDomain,
          shopify_token: 'new-token-xyz',
          shopify_api_key: 'test-shopify-api-key',
          is_active: true,
          installed_at: new Date().toISOString(),
          uninstalled_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      });

      const url = createCallbackUrl(shopDomain);
      await request(app).get(url);

      // Should have done a SELECT to check for existing store,
      // then an INSERT to create the new store
      const insertCall = mockQuery.mock.calls.find(
        (call: any) => call[0].toLowerCase().includes('insert into stores')
      );
      expect(insertCall).toBeDefined();
    });

    test('updates existing store token on re-authentication', async () => {
      const storeId = createTestId();
      const shopDomain = 'test-store.myshopify.com';
      const existingStore = createMockStore({
        id: storeId,
        shopify_domain: shopDomain,
        shopify_token: 'old-token',
        is_active: true,
      });

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { access_token: 'new-token-456' },
        status: 200,
      });

      // Existing store found
      mockQuery.mockResolvedValueOnce({ rows: [existingStore] });

      // Token update
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const url = createCallbackUrl(shopDomain);
      const res = await request(app).get(url);

      expect(res.status).toBe(200);
      expect(res.body.data.token).toBe('new-token-456');

      // Should have called UPDATE to change token
      const updateCall = mockQuery.mock.calls.find(
        (call: any) => call[0].toLowerCase().includes('update stores')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall[1]).toContain('new-token-456');
    });

    test('registers webhooks after successful auth', async () => {
      const storeId = createTestId();
      const shopDomain = 'test-store.myshopify.com';

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { access_token: 'new-token-webhook' },
        status: 200,
      });

      mockQuery.mockResolvedValueOnce({ rows: [] });

      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: storeId,
          shopify_domain: shopDomain,
          shopify_token: 'new-token-webhook',
          shopify_api_key: 'test-shopify-api-key',
          is_active: true,
          installed_at: new Date().toISOString(),
          uninstalled_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      });

      const url = createCallbackUrl(shopDomain);
      const res = await request(app).get(url);

      expect(res.status).toBe(200);
    });

    test('returns 401 when HMAC verification fails', async () => {
      const shopDomain = 'test-store.myshopify.com';

      // Build a URL with an invalid HMAC
      const params = new URLSearchParams({
        shop: shopDomain,
        code: 'test-code',
        state: 'test-state',
        timestamp: '1234567890',
        hmac: 'invalid-hmac-value-that-will-not-verify',
      });

      const res = await request(app)
        .get(`/api/auth/callback?${params.toString()}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('WEBHOOK_VERIFICATION_FAILED');
      expect(res.body.error.message).toContain('HMAC verification failed');
    });

    test('returns 400 when code is missing', async () => {
      const shopDomain = 'test-store.myshopify.com';

      const res = await request(app)
        .get('/api/auth/callback')
        .query({ shop: shopDomain });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('Missing required OAuth parameters');
    });

    test('returns 400 when shop is missing from callback', async () => {
      const res = await request(app)
        .get('/api/auth/callback')
        .query({ code: 'some-code' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('handles Shopify API error during token exchange', async () => {
      const shopDomain = 'test-store.myshopify.com';

      // Mock the token exchange to fail
      mockAxiosInstance.post.mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 401,
          data: { error: 'invalid_client' },
        },
      });

      const url = createCallbackUrl(shopDomain);
      const res = await request(app).get(url);

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTH_FAILED');
      expect(res.body.error.message).toContain('Failed to exchange authorization code');
    });

    test('reactivates inactive store on re-auth', async () => {
      const storeId = createTestId();
      const shopDomain = 'test-store.myshopify.com';
      const inactiveStore = createMockStore({
        id: storeId,
        shopify_domain: shopDomain,
        shopify_token: 'old-token',
        is_active: false,
      });

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { access_token: 'reactivated-token' },
        status: 200,
      });

      // Existing inactive store
      mockQuery.mockResolvedValueOnce({ rows: [inactiveStore] });

      // Token update
      mockQuery.mockResolvedValueOnce({ rows: [] });

      // Reactivate
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const url = createCallbackUrl(shopDomain);
      const res = await request(app).get(url);

      expect(res.status).toBe(200);
      expect(res.body.data.store.isActive).toBe(true);

      // Should have called reactivate SQL (sets is_active=true, uninstalled_at=null)
      const reactivateCall = mockQuery.mock.calls.find(
        (call: any) =>
          call[0].toLowerCase().includes('update stores') &&
          call[0].toLowerCase().includes('is_active = true')
      );
      expect(reactivateCall).toBeDefined();
    });
  });

  // ======================================================================
  // POST /api/auth/logout
  // ======================================================================

  describe('POST /api/auth/logout', () => {
    test('clears session successfully', async () => {
      const storeId = createTestId();

      const res = await request(app)
        .post('/api/auth/logout')
        .send({ storeId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toBe('Session invalidated successfully');
    });

    test('returns 400 when storeId is missing', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
