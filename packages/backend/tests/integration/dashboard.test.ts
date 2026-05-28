// ============================================================================
// Dashboard API Integration Tests
// ============================================================================

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import {
  mockQuery,
  createMockStore,
  createMockCredential,
  createMockSyncLog,
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

function generateTestToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: 'https://test-store.myshopify.com/admin',
      dest: 'https://test-store.myshopify.com',
      aud: process.env.SHOPIFY_API_KEY,
      sub: 'test-store.myshopify.com',
      exp: now + 3600,
      nbf: now,
      iat: now,
      jti: uuidv4(),
      sid: uuidv4(),
    },
    process.env.SHOPIFY_API_SECRET!,
    { algorithm: 'HS256' },
  );
}

const authHeader = { Authorization: `Bearer ${generateTestToken()}` };

import dashboardRoutes from '../../src/routes/dashboard.routes';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req: any, _res: any, next: any) => {
  req.requestId = 'test-request-id';
  next();
});
app.use('/api/dashboard', dashboardRoutes);

describe('Dashboard API Integration', () => {
  // ======================================================================
  // GET /api/dashboard/summary
  // ======================================================================

  describe('GET /api/dashboard/summary', () => {
    test('returns aggregated dashboard statistics', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });

      // findById: store exists
      mockQuery.mockResolvedValueOnce({ rows: [store] });
      // sync job counts by status
      mockQuery.mockResolvedValueOnce({
        rows: [
          { status: 'completed', count: 45 },
          { status: 'running', count: 2 },
          { status: 'failed', count: 5 },
          { status: 'pending', count: 3 },
          { status: 'queued', count: 1 },
        ],
      });
      // recent jobs
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // entity counts
      mockQuery.mockResolvedValueOnce({
        rows: [
          { entity_type: 'item', count: 20 },
          { entity_type: 'order', count: 15 },
          { entity_type: 'customer', count: 10 },
          { entity_type: 'price', count: 5 },
          { entity_type: 'inventory', count: 6 },
        ],
      });
      // recent errors
      mockQuery.mockResolvedValueOnce({
        rows: [
          createMockSyncLog({
            action: 'failed',
            error_message: 'Shopify API rate limit exceeded',
          }),
        ],
      });
      // credential status
      mockQuery.mockResolvedValueOnce({
        rows: [createMockCredential({ store_id: storeId })],
      });

      const res = await request(app)
        .get('/api/dashboard/summary')
        .set(authHeader)
        .query({ storeId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.overview).toBeDefined();
      expect(res.body.data.overview.totalSyncJobs).toBe(56);
      expect(res.body.data.overview.completedJobs).toBe(45);
      expect(res.body.data.overview.runningJobs).toBe(2);
      expect(res.body.data.overview.failedJobs).toBe(5);
      expect(res.body.data.overview.pendingJobs).toBe(3);
      expect(res.body.data.overview.queuedJobs).toBe(1);
    });

    test('includes sync success rate', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({
        rows: [
          { status: 'completed', count: 90 },
          { status: 'failed', count: 10 },
        ],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // no credentials
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/dashboard/summary')
        .set(authHeader)
        .query({ storeId });

      expect(res.status).toBe(200);
      expect(res.body.data.overview.completedJobs).toBe(90);
      expect(res.body.data.overview.failedJobs).toBe(10);
      expect(res.body.data.overview.totalSyncJobs).toBe(100);
    });

    test('includes entity breakdown', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'completed', count: 10 }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({
        rows: [
          { entity_type: 'item', count: 4 },
          { entity_type: 'order', count: 3 },
          { entity_type: 'customer', count: 3 },
        ],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/dashboard/summary')
        .set(authHeader)
        .query({ storeId });

      expect(res.status).toBe(200);
      expect(res.body.data.entityDistribution).toBeDefined();
      expect(res.body.data.entityDistribution.item).toBe(4);
      expect(res.body.data.entityDistribution.order).toBe(3);
    });

    test('includes recent errors', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({
        rows: [
          createMockSyncLog({ action: 'failed', error_message: 'API timeout' }),
        ],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/dashboard/summary')
        .set(authHeader)
        .query({ storeId });

      expect(res.status).toBe(200);
      expect(res.body.data.recentErrors).toHaveLength(1);
      expect(res.body.data.recentErrors[0].action).toBe('failed');
    });

    test('includes credential status', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // credentials exist
      mockQuery.mockResolvedValueOnce({
        rows: [createMockCredential({
          store_id: storeId,
          is_valid: true,
          environment: 'production',
        })],
      });

      const res = await request(app)
        .get('/api/dashboard/summary')
        .set(authHeader)
        .query({ storeId });

      expect(res.status).toBe(200);
      expect(res.body.data.credentials).toBeDefined();
      expect(res.body.data.credentials.configured).toBe(true);
      expect(res.body.data.credentials.isValid).toBe(true);
      expect(res.body.data.credentials.environment).toBe('production');
    });

    test('returns configured: false when no credentials exist', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // no credentials
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/dashboard/summary')
        .set(authHeader)
        .query({ storeId });

      expect(res.status).toBe(200);
      expect(res.body.data.credentials.configured).toBe(false);
    });
  });

  // ======================================================================
  // GET /api/dashboard/activity
  // ======================================================================

  describe('GET /api/dashboard/activity', () => {
    test('returns recent sync activity', async () => {
      const storeId = createTestId();
      const now = new Date().toISOString();

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: createTestId(),
            entity_type: 'item',
            direction: 'shopify_to_oracle',
            status: 'completed',
            trigger: 'manual',
            total_records: 10,
            processed_records: 10,
            failed_records: 0,
            created_at: now,
            completed_at: now,
            log_count: 5,
          },
        ],
      });

      const res = await request(app)
        .get('/api/dashboard/activity')
        .set(authHeader)
        .query({ storeId, limit: 20 });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].entity_type).toBe('item');
      expect(res.body.data[0].log_count).toBe(5);
    });

    test('limited to recent entries', async () => {
      const storeId = createTestId();

      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/dashboard/activity')
        .set(authHeader)
        .query({ storeId });

      expect(res.status).toBe(200);

      // Default limit should be applied
      const queryCall = mockQuery.mock.calls[0];
      expect(queryCall[0]).toContain('LIMIT');
    });
  });

  // ======================================================================
  // GET /api/dashboard/stats
  // ======================================================================

  describe('GET /api/dashboard/stats', () => {
    test('returns daily time-series data', async () => {
      const storeId = createTestId();

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            day: '2024-01-15',
            total_jobs: 12,
            completed_jobs: 10,
            failed_jobs: 1,
            partial_jobs: 1,
            total_processed: 500,
            total_failed: 5,
          },
          {
            day: '2024-01-14',
            total_jobs: 8,
            completed_jobs: 7,
            failed_jobs: 1,
            partial_jobs: 0,
            total_processed: 350,
            total_failed: 3,
          },
        ],
      });

      const res = await request(app)
        .get('/api/dashboard/stats')
        .set(authHeader)
        .query({ storeId, days: 30 });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].day).toBe('2024-01-15');
      expect(res.body.data[0].total_jobs).toBe(12);
      expect(res.body.data[1].completed_jobs).toBe(7);
    });

    test('validates days parameter range', async () => {
      const storeId = createTestId();

      const res = await request(app)
        .get('/api/dashboard/stats')
        .set(authHeader)
        .query({ storeId, days: 200 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('defaults to 30 days when not specified', async () => {
      const storeId = createTestId();

      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/dashboard/stats')
        .set(authHeader)
        .query({ storeId });

      expect(res.status).toBe(200);
    });
  });
});
