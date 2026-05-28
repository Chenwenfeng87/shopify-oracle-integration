// ============================================================================
// Sync API Integration Tests
// ============================================================================

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import {
  mockQuery,
  createMockStore,
  createMockSyncJob,
  createMockSyncLog,
  createTestId,
} from '../setup';

// Logger mock
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

jest.mock('../../src/middleware/rate-limit', () => ({
  authRateLimit: (() => (req: any, res: any, next: any) => next())(),
  syncRateLimit: (() => (req: any, res: any, next: any) => next())(),
  generalRateLimit: (() => (req: any, res: any, next: any) => next())(),
}));

// Generate a valid JWT for the shopifyAuth middleware
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

import syncRoutes from '../../src/routes/sync.routes';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req: any, _res: any, next: any) => {
  req.requestId = 'test-request-id';
  next();
});
app.use('/api/sync', syncRoutes);

describe('Sync API Integration', () => {
  describe('POST /api/sync/start', () => {
    const validPayload = {
      storeId: createTestId(),
      entityType: 'item',
      direction: 'shopify_to_oracle',
      trigger: 'manual',
      totalRecords: 100,
    };

    test('triggers item sync from Oracle to Shopify', async () => {
      const storeId = createTestId();
      const jobId = createTestId();
      const store = createMockStore({ id: storeId, is_active: true });

      // findById: store exists and is active
      mockQuery.mockResolvedValueOnce({ rows: [store] });
      // findByStoreId for running job check: no existing running jobs
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      // create: insert sync job
      mockQuery.mockResolvedValueOnce({
        rows: [createMockSyncJob({ id: jobId, store_id: storeId, entity_type: 'item', direction: 'oracle_to_shopify' })],
      });

      const res = await request(app)
        .post('/api/sync/start')
        .set(authHeader)
        .send({
          storeId,
          entityType: 'item',
          direction: 'oracle_to_shopify',
          trigger: 'manual',
          totalRecords: 100,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(jobId);
    });

    test('triggers customer sync from Shopify to Oracle', async () => {
      const storeId = createTestId();
      const jobId = createTestId();
      const store = createMockStore({ id: storeId, is_active: true });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockQuery.mockResolvedValueOnce({
        rows: [createMockSyncJob({ id: jobId, store_id: storeId, entity_type: 'customer' })],
      });

      const res = await request(app)
        .post('/api/sync/start')
        .set(authHeader)
        .send({ ...validPayload, storeId, entityType: 'customer' });

      expect(res.status).toBe(201);
      expect(res.body.data.entityType).toBe('customer');
    });

    test('triggers order sync from Shopify to Oracle', async () => {
      const storeId = createTestId();
      const jobId = createTestId();
      const store = createMockStore({ id: storeId, is_active: true });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockQuery.mockResolvedValueOnce({
        rows: [createMockSyncJob({ id: jobId, store_id: storeId, entity_type: 'order' })],
      });

      const res = await request(app)
        .post('/api/sync/start')
        .set(authHeader)
        .send({ ...validPayload, storeId, entityType: 'order' });

      expect(res.status).toBe(201);
    });

    test('triggers price sync from Shopify to Oracle', async () => {
      const storeId = createTestId();
      const jobId = createTestId();
      const store = createMockStore({ id: storeId, is_active: true });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockQuery.mockResolvedValueOnce({
        rows: [createMockSyncJob({ id: jobId, store_id: storeId, entity_type: 'price' })],
      });

      const res = await request(app)
        .post('/api/sync/start')
        .set(authHeader)
        .send({ ...validPayload, storeId, entityType: 'price' });

      expect(res.status).toBe(201);
    });

    test('triggers inventory sync from Oracle to Shopify', async () => {
      const storeId = createTestId();
      const jobId = createTestId();
      const store = createMockStore({ id: storeId, is_active: true });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockQuery.mockResolvedValueOnce({
        rows: [createMockSyncJob({ id: jobId, store_id: storeId, entity_type: 'inventory' })],
      });

      const res = await request(app)
        .post('/api/sync/start')
        .set(authHeader)
        .send({ ...validPayload, storeId, entityType: 'inventory' });

      expect(res.status).toBe(201);
    });

    test('returns 400 for invalid entity type', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId, is_active: true });
      mockQuery.mockResolvedValueOnce({ rows: [store] });

      const res = await request(app)
        .post('/api/sync/start')
        .set(authHeader)
        .send({ ...validPayload, storeId, entityType: 'invalid_entity' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('returns 409 when sync already running for same entity', async () => {
      const storeId = createTestId();
      const existingJobId = createTestId();
      const store = createMockStore({ id: storeId, is_active: true });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      // Running job exists
      mockQuery.mockResolvedValueOnce({
        rows: [createMockSyncJob({ id: existingJobId, store_id: storeId, status: 'running' })],
      });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });

      const res = await request(app)
        .post('/api/sync/start')
        .set(authHeader)
        .send({ ...validPayload, storeId });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SYNC_IN_PROGRESS');
      expect(res.body.error.details.existingJobId).toBe(existingJobId);
    });

    test('creates sync job record in database', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId, is_active: true });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockQuery.mockResolvedValueOnce({
        rows: [createMockSyncJob({ store_id: storeId, entity_type: 'item' })],
      });

      const res = await request(app)
        .post('/api/sync/start')
        .set(authHeader)
        .send({ ...validPayload, storeId });

      expect(res.status).toBe(201);

      // Should have inserted a sync job
      const insertCall = mockQuery.mock.calls.find(
        (call: any) => call[0].toLowerCase().includes('insert into sync_jobs')
      );
      expect(insertCall).toBeDefined();
    });

    test('returns 400 for inactive store', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId, is_active: false });

      mockQuery.mockResolvedValueOnce({ rows: [store] });

      const res = await request(app)
        .post('/api/sync/start')
        .set(authHeader)
        .send({ ...validPayload, storeId });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('STORE_INACTIVE');
    });

    test('returns 404 for non-existent store', async () => {
      const storeId = createTestId();
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/sync/start')
        .set(authHeader)
        .send({ ...validPayload, storeId });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ======================================================================
  // GET /api/sync/jobs
  // ======================================================================

  describe('GET /api/sync/jobs', () => {
    test('returns paginated job list', async () => {
      const storeId = createTestId();
      const jobs = [
        createMockSyncJob({ store_id: storeId, entity_type: 'item', status: 'completed' }),
        createMockSyncJob({ store_id: storeId, entity_type: 'order', status: 'running' }),
      ];

      // Count query
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 2 }] });
      // Data query
      mockQuery.mockResolvedValueOnce({ rows: jobs });

      const res = await request(app)
        .get('/api/sync/jobs')
        .set(authHeader)
        .query({ storeId, limit: 20, offset: 0 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.pagination).toBeDefined();
      expect(res.body.meta.pagination.total).toBe(2);
    });

    test('filters by entity type', async () => {
      const storeId = createTestId();
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
      mockQuery.mockResolvedValueOnce({
        rows: [createMockSyncJob({ store_id: storeId, entity_type: 'customer' })],
      });

      const res = await request(app)
        .get('/api/sync/jobs')
        .set(authHeader)
        .query({ storeId, entityType: 'customer' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].entityType).toBe('customer');

      // Verify filter was applied in query
      const whereClause = mockQuery.mock.calls.find(
        (call: any) => call[0].includes('WHERE')
      )?.[0];
      expect(whereClause).toContain('entity_type');
    });

    test('filters by status', async () => {
      const storeId = createTestId();
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
      mockQuery.mockResolvedValueOnce({
        rows: [createMockSyncJob({ store_id: storeId, status: 'failed' })],
      });

      const res = await request(app)
        .get('/api/sync/jobs')
        .set(authHeader)
        .query({ storeId, status: 'failed' });

      expect(res.status).toBe(200);
      expect(res.body.data[0].status).toBe('failed');
    });

    test('filters by date range', async () => {
      const storeId = createTestId();
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
      mockQuery.mockResolvedValueOnce({
        rows: [createMockSyncJob({ store_id: storeId })],
      });

      const res = await request(app)
        .get('/api/sync/jobs')
        .set(authHeader)
        .query({
          storeId,
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2024-12-31T23:59:59Z',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('returns empty array for no results', async () => {
      const storeId = createTestId();
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/sync/jobs')
        .set(authHeader)
        .query({ storeId });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.pagination.total).toBe(0);
    });
  });

  // ======================================================================
  // GET /api/sync/jobs/:jobId
  // ======================================================================

  describe('GET /api/sync/jobs/:jobId', () => {
    test('returns job details', async () => {
      const jobId = createTestId();
      const job = createMockSyncJob({ id: jobId });

      mockQuery.mockResolvedValueOnce({ rows: [job] });

      const res = await request(app)
        .get(`/api/sync/jobs/${jobId}`)
        .set(authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(jobId);
      expect(res.body.data.entityType).toBe(job.entity_type);
      expect(res.body.data.status).toBe(job.status);
    });

    test('includes progress information', async () => {
      const jobId = createTestId();
      const job = createMockSyncJob({
        id: jobId,
        total_records: 100,
        processed_records: 45,
        failed_records: 5,
        status: 'running',
      });

      mockQuery.mockResolvedValueOnce({ rows: [job] });

      const res = await request(app)
        .get(`/api/sync/jobs/${jobId}`)
        .set(authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data.totalRecords).toBe(100);
      expect(res.body.data.processedRecords).toBe(45);
      expect(res.body.data.failedRecords).toBe(5);
    });

    test('returns 404 for non-existent job', async () => {
      const jobId = createTestId();
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get(`/api/sync/jobs/${jobId}`)
        .set(authHeader);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ======================================================================
  // GET /api/sync/jobs/:jobId/logs
  // ======================================================================

  describe('GET /api/sync/jobs/:jobId/logs', () => {
    test('returns paginated logs', async () => {
      const jobId = createTestId();
      const logs = [
        createMockSyncLog({ sync_job_id: jobId, action: 'created' }),
        createMockSyncLog({ sync_job_id: jobId, action: 'updated' }),
      ];

      // findById: job exists
      mockQuery.mockResolvedValueOnce({ rows: [createMockSyncJob({ id: jobId })] });
      // Count
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 2 }] });
      // Data
      mockQuery.mockResolvedValueOnce({ rows: logs });

      const res = await request(app)
        .get(`/api/sync/jobs/${jobId}/logs`)
        .set(authHeader)
        .query({ limit: 50, offset: 0 });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.pagination).toBeDefined();
    });

    test('filters by action type', async () => {
      const jobId = createTestId();

      mockQuery.mockResolvedValueOnce({ rows: [createMockSyncJob({ id: jobId })] });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
      mockQuery.mockResolvedValueOnce({
        rows: [createMockSyncLog({ sync_job_id: jobId, action: 'failed' })],
      });

      const res = await request(app)
        .get(`/api/sync/jobs/${jobId}/logs`)
        .set(authHeader)
        .query({ action: 'failed' });

      expect(res.status).toBe(200);
      expect(res.body.data[0].action).toBe('failed');
    });

    test('returns empty for completed job with no errors', async () => {
      const jobId = createTestId();

      mockQuery.mockResolvedValueOnce({ rows: [createMockSyncJob({ id: jobId, status: 'completed' })] });
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get(`/api/sync/jobs/${jobId}/logs`)
        .set(authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    test('returns 404 for non-existent job logs', async () => {
      const jobId = createTestId();
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get(`/api/sync/jobs/${jobId}/logs`)
        .set(authHeader);

      expect(res.status).toBe(404);
    });
  });

  // ======================================================================
  // POST /api/sync/jobs/:jobId/cancel
  // ======================================================================

  describe('POST /api/sync/jobs/:jobId/cancel', () => {
    test('cancels running job', async () => {
      const jobId = createTestId();
      const job = createMockSyncJob({ id: jobId, status: 'running' });

      mockQuery.mockResolvedValueOnce({ rows: [job] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post(`/api/sync/jobs/${jobId}/cancel`)
        .set(authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Sync job cancelled successfully');
    });

    test('cancels pending job', async () => {
      const jobId = createTestId();
      const job = createMockSyncJob({ id: jobId, status: 'pending' });

      mockQuery.mockResolvedValueOnce({ rows: [job] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post(`/api/sync/jobs/${jobId}/cancel`)
        .set(authHeader);

      expect(res.status).toBe(200);
    });

    test('returns 400 for already completed job', async () => {
      const jobId = createTestId();
      const job = createMockSyncJob({ id: jobId, status: 'completed' });

      mockQuery.mockResolvedValueOnce({ rows: [job] });

      const res = await request(app)
        .post(`/api/sync/jobs/${jobId}/cancel`)
        .set(authHeader);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    test('returns 400 for already failed job', async () => {
      const jobId = createTestId();
      const job = createMockSyncJob({ id: jobId, status: 'failed' });

      mockQuery.mockResolvedValueOnce({ rows: [job] });

      const res = await request(app)
        .post(`/api/sync/jobs/${jobId}/cancel`)
        .set(authHeader);

      expect(res.status).toBe(400);
    });

    test('returns 404 for non-existent job', async () => {
      const jobId = createTestId();
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post(`/api/sync/jobs/${jobId}/cancel`)
        .set(authHeader);

      expect(res.status).toBe(404);
    });
  });

  // ======================================================================
  // GET /api/sync/errors
  // ======================================================================

  describe('GET /api/sync/errors', () => {
    test('returns recent sync errors', async () => {
      const storeId = createTestId();
      const errors = [
        createMockSyncLog({ action: 'failed', error_message: 'API timeout' }),
        createMockSyncLog({ action: 'failed', error_message: 'Validation failed' }),
      ];

      // The errors endpoint does a JOIN query to find errors by store
      mockQuery.mockResolvedValueOnce({ rows: errors });

      const res = await request(app)
        .get('/api/sync/errors')
        .set(authHeader)
        .query({ storeId, limit: 50 });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].action).toBe('failed');
    });

    test('returns empty array when no errors', async () => {
      const storeId = createTestId();
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/sync/errors')
        .set(authHeader)
        .query({ storeId });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });
});
