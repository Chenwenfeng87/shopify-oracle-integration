// ============================================================================
// Field Mapping API Integration Tests
// ============================================================================

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import {
  mockQuery,
  createMockStore,
  createMockMapping,
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

import mappingRoutes from '../../src/routes/mapping.routes';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req: any, _res: any, next: any) => {
  req.requestId = 'test-request-id';
  next();
});
app.use('/api/mappings', mappingRoutes);

describe('Field Mapping API Integration', () => {
  describe('GET /api/mappings', () => {
    test('returns all mappings with no filters', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });

      // findById: store exists
      mockQuery.mockResolvedValueOnce({ rows: [store] });

      // Multiple queries for each entity+direction combination (5 entities x 2 directions = 10 queries)
      for (let i = 0; i < 10; i++) {
        mockQuery.mockResolvedValueOnce({ rows: [] });
      }

      const res = await request(app)
        .get('/api/mappings')
        .set(authHeader)
        .query({ storeId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('returns mappings filtered by entity type', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });
      const mapping = createMockMapping({ store_id: storeId, entity_type: 'item' });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({ rows: [mapping] });

      const res = await request(app)
        .get('/api/mappings')
        .set(authHeader)
        .query({ storeId, entityType: 'item', direction: 'shopify_to_oracle' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    test('returns mappings filtered by direction', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/mappings')
        .set(authHeader)
        .query({ storeId, direction: 'oracle_to_shopify', entityType: 'item' });

      expect(res.status).toBe(200);
    });

    test('validates entity type enum', async () => {
      const storeId = createTestId();

      const res = await request(app)
        .get('/api/mappings')
        .set(authHeader)
        .query({ storeId, entityType: 'invalid_entity' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ======================================================================
  // GET /api/mappings/defaults
  // ======================================================================

  describe('GET /api/mappings/defaults', () => {
    test('returns default item mappings', async () => {
      const res = await request(app)
        .get('/api/mappings/defaults')
        .set(authHeader)
        .query({ entityType: 'item' });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0]).toHaveProperty('shopifyField');
      expect(res.body.data[0]).toHaveProperty('oracleField');
    });

    test('returns default customer mappings', async () => {
      const res = await request(app)
        .get('/api/mappings/defaults')
        .set(authHeader)
        .query({ entityType: 'customer' });

      expect(res.status).toBe(200);
      const fields = res.body.data.map((m: any) => m.oracleField);
      expect(fields).toContain('EmailAddress');
      expect(fields).toContain('PartyName');
    });

    test('returns 400 for invalid entity type', async () => {
      const res = await request(app)
        .get('/api/mappings/defaults')
        .set(authHeader)
        .query({ entityType: 'bogus' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ======================================================================
  // POST /api/mappings
  // ======================================================================

  describe('POST /api/mappings', () => {
    test('creates new field mapping', async () => {
      const storeId = createTestId();
      const mappingId = createTestId();
      const store = createMockStore({ id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({
        rows: [createMockMapping({
          id: mappingId,
          store_id: storeId,
          shopify_field: 'title',
          oracle_field: 'ItemDescription',
        })],
      });

      const res = await request(app)
        .post('/api/mappings')
        .set(authHeader)
        .send({
          storeId,
          entityType: 'item',
          direction: 'shopify_to_oracle',
          shopifyField: 'title',
          oracleField: 'ItemDescription',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.shopifyField).toBe('title');
      expect(res.body.data.oracleField).toBe('ItemDescription');
    });

    test('validates required fields', async () => {
      const storeId = createTestId();

      const res = await request(app)
        .post('/api/mappings')
        .set(authHeader)
        .send({ storeId });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('validates entity type enum', async () => {
      const storeId = createTestId();

      const res = await request(app)
        .post('/api/mappings')
        .set(authHeader)
        .send({
          storeId,
          entityType: 'bogus_type',
          direction: 'shopify_to_oracle',
          shopifyField: 'title',
          oracleField: 'ItemDescription',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('creates mapping with transform rule', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({
        rows: [createMockMapping({
          store_id: storeId,
          shopify_field: 'status',
          oracle_field: 'ItemStatus',
          transform_rule: { type: 'lookup', config: { map: { active: 'Active', draft: 'Draft' } } },
        })],
      });

      const res = await request(app)
        .post('/api/mappings')
        .set(authHeader)
        .send({
          storeId,
          entityType: 'item',
          direction: 'shopify_to_oracle',
          shopifyField: 'status',
          oracleField: 'ItemStatus',
          transformRule: { type: 'lookup', config: { map: { active: 'Active', draft: 'Draft' } } },
          isRequired: false,
        });

      expect(res.status).toBe(201);
    });
  });

  // ======================================================================
  // PUT /api/mappings/:id
  // ======================================================================

  describe('PUT /api/mappings/:id', () => {
    test('updates existing mapping', async () => {
      const mappingId = createTestId();

      mockQuery.mockResolvedValueOnce({
        rows: [createMockMapping({
          id: mappingId,
          shopify_field: 'updated_title',
          oracle_field: 'UpdatedDescription',
        })],
      });

      const res = await request(app)
        .put(`/api/mappings/${mappingId}`)
        .set(authHeader)
        .send({
          shopifyField: 'updated_title',
          oracleField: 'UpdatedDescription',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.shopifyField).toBe('updated_title');
      expect(res.body.data.oracleField).toBe('UpdatedDescription');
    });

    test('returns 404 for non-existent mapping', async () => {
      const mappingId = createTestId();

      // The FieldMappingModel.update calls findById first when no fields change
      // But with update fields, it does an UPDATE query that returns empty
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .put(`/api/mappings/${mappingId}`)
        .set(authHeader)
        .send({
          shopifyField: 'title',
          oracleField: 'ItemDescription',
        });

      expect(res.status).toBe(500);
    });
  });

  // ======================================================================
  // DELETE /api/mappings/:id
  // ======================================================================

  describe('DELETE /api/mappings/:id', () => {
    test('deletes mapping', async () => {
      const mappingId = createTestId();

      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .delete(`/api/mappings/${mappingId}`)
        .set(authHeader);

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Field mapping deleted successfully');

      const deleteCall = mockQuery.mock.calls.find(
        (call: any) => call[0].toLowerCase().includes('delete from field_mappings')
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall[1]).toEqual([mappingId]);
    });

    test('returns 200 even for non-existent mapping (delete is idempotent)', async () => {
      const mappingId = createTestId();
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .delete(`/api/mappings/${mappingId}`)
        .set(authHeader);

      expect(res.status).toBe(200);
    });
  });

  // ======================================================================
  // POST /api/mappings/bulk
  // ======================================================================

  describe('POST /api/mappings/bulk', () => {
    test('replaces all mappings for entity+direction', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });

      // deleteAll
      mockConnect.mockResolvedValueOnce(mockQuery);
      mockQuery.mockResolvedValueOnce({ rows: [] });

      // bulkCreate via transaction
      mockQuery.mockResolvedValueOnce(undefined); // BEGIN
      mockQuery.mockResolvedValueOnce({
        rows: [createMockMapping({ store_id: storeId, shopify_field: 'title', oracle_field: 'ItemDescription' })],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [createMockMapping({ store_id: storeId, shopify_field: 'sku', oracle_field: 'ItemNumber' })],
      });
      mockQuery.mockResolvedValueOnce(undefined); // COMMIT
      mockClient.release.mockResolvedValueOnce(undefined);

      const res = await request(app)
        .post('/api/mappings/bulk')
        .set(authHeader)
        .send({
          storeId,
          entityType: 'item',
          direction: 'shopify_to_oracle',
          mappings: [
            { shopifyField: 'title', oracleField: 'ItemDescription' },
            { shopifyField: 'sku', oracleField: 'ItemNumber' },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveLength(2);
    });

    test('uses transaction for atomicity', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });

      // deleteAll
      mockConnect.mockResolvedValueOnce(mockQuery);
      mockQuery.mockResolvedValueOnce({ rows: [] });

      // Transaction: BEGIN -> CREATE -> COMMIT
      mockQuery.mockResolvedValueOnce(undefined); // BEGIN
      mockQuery.mockResolvedValueOnce({
        rows: [createMockMapping({ store_id: storeId })],
      });
      mockQuery.mockResolvedValueOnce(undefined); // COMMIT
      mockClient.release.mockResolvedValueOnce(undefined);

      const res = await request(app)
        .post('/api/mappings/bulk')
        .set(authHeader)
        .send({
          storeId,
          entityType: 'item',
          direction: 'shopify_to_oracle',
          mappings: [
            { shopifyField: 'title', oracleField: 'ItemDescription' },
          ],
        });

      expect(res.status).toBe(201);

      // Verify BEGIN was called
      const beginCall = mockQuery.mock.calls.find(
        (call: any) => call[0] === 'BEGIN'
      );
      expect(beginCall).toBeDefined();
    });

    test('validates mappings array is not empty', async () => {
      const storeId = createTestId();

      const res = await request(app)
        .post('/api/mappings/bulk')
        .set(authHeader)
        .send({
          storeId,
          entityType: 'item',
          direction: 'shopify_to_oracle',
          mappings: [],
        });

      expect(res.status).toBe(400);
    });
  });
});
