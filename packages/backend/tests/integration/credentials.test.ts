// ============================================================================
// Credentials API Integration Tests
// ============================================================================

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import {
  mockQuery,
  createMockStore,
  createMockCredential,
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

// Mock encryption to return predictable values
jest.mock('../../src/utils/encryption', () => ({
  encryptCredentials: jest.fn(() => ({
    username: 'encrypted_user_hex',
    password: 'encrypted_pass_hex',
    iv: 'test_iv_hex_string',
    tag: 'test_tag_hex_string',
  })),
  decryptCredentials: jest.fn(() => ({
    username: 'oracle_username',
    password: 'oracle_password_secret',
  })),
  encrypt: jest.fn(() => ({
    encrypted: 'encrypted_data_hex',
    iv: 'test_iv_hex',
    tag: 'test_tag_hex',
  })),
  decrypt: jest.fn(() => 'decrypted_data'),
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

import credentialsRoutes from '../../src/routes/credentials.routes';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req: any, _res: any, next: any) => {
  req.requestId = 'test-request-id';
  next();
});
app.use('/api/credentials', credentialsRoutes);

describe('Credentials API Integration', () => {
  // ======================================================================
  // POST /api/credentials
  // ======================================================================

  describe('POST /api/credentials', () => {
    test('saves Oracle credentials (encrypted)', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });

      // findById: store exists
      mockQuery.mockResolvedValueOnce({ rows: [store] });
      // findByStoreId: no existing credentials
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // Insert new credentials
      mockQuery.mockResolvedValueOnce({
        rows: [createMockCredential({ store_id: storeId })],
      });

      const res = await request(app)
        .post('/api/credentials')
        .set(authHeader)
        .send({
          storeId,
          username: 'oracle_user',
          password: 'oracle_pass_123',
          baseUrl: 'https://oracle-instance.example.com',
          environment: 'production',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.baseUrl).toBe('https://oracle-instance.example.com');
      expect(res.body.data.password).toBe('......');
    });

    test('updates existing credentials', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });
      const existingCred = createMockCredential({ store_id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      // findByStoreId: credentials exist
      mockQuery.mockResolvedValueOnce({ rows: [existingCred] });
      // Update
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...existingCred, base_url: 'https://updated-oracle.example.com' }],
      });

      const res = await request(app)
        .post('/api/credentials')
        .set(authHeader)
        .send({
          storeId,
          username: 'updated_user',
          password: 'updated_pass',
          baseUrl: 'https://updated-oracle.example.com',
          environment: 'production',
        });

      expect(res.status).toBe(201);
    });

    test('validates base_url format', async () => {
      const storeId = createTestId();

      const res = await request(app)
        .post('/api/credentials')
        .set(authHeader)
        .send({
          storeId,
          username: 'user',
          password: 'pass',
          baseUrl: 'not-a-valid-url',
          environment: 'production',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('validates required fields', async () => {
      const storeId = createTestId();

      const res = await request(app)
        .post('/api/credentials')
        .set(authHeader)
        .send({ storeId });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('validates empty username', async () => {
      const storeId = createTestId();

      const res = await request(app)
        .post('/api/credentials')
        .set(authHeader)
        .send({
          storeId,
          username: '',
          password: 'somepass',
          baseUrl: 'https://oracle.example.com',
          environment: 'production',
        });

      expect(res.status).toBe(400);
    });
  });

  // ======================================================================
  // GET /api/credentials
  // ======================================================================

  describe('GET /api/credentials', () => {
    test('returns credentials with masked password', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });
      const credential = createMockCredential({ store_id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({ rows: [credential] });

      const res = await request(app)
        .get('/api/credentials')
        .set(authHeader)
        .query({ storeId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.password).toBe('......');
      expect(res.body.data.username).toBeDefined();
      // Password should not be the actual value
      expect(res.body.data.password).not.toBe('oracle_password_secret');
    });

    test('returns 404 when no credentials configured', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/credentials')
        .set(authHeader)
        .query({ storeId });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toContain('No Oracle credentials configured');
    });

    test('does not expose encrypted password', async () => {
      const storeId = createTestId();
      const store = createMockStore({ id: storeId });
      const credential = createMockCredential({ store_id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [store] });
      mockQuery.mockResolvedValueOnce({ rows: [credential] });

      const res = await request(app)
        .get('/api/credentials')
        .set(authHeader)
        .query({ storeId });

      expect(res.status).toBe(200);
      // Ensure we don't leak password
      expect(res.body.data.password).not.toMatch(/^encrypted_/);
      expect(res.body.data.password).not.toContain('secret');
    });
  });

  // ======================================================================
  // PUT /api/credentials
  // ======================================================================

  describe('PUT /api/credentials', () => {
    test('partially updates credentials', async () => {
      const storeId = createTestId();
      const existingCred = createMockCredential({ store_id: storeId });

      // findByStoreId: check existing
      mockQuery.mockResolvedValueOnce({ rows: [existingCred] });
      // Update
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...existingCred, environment: 'development' }],
      });

      const res = await request(app)
        .put('/api/credentials')
        .set(authHeader)
        .send({
          storeId,
          environment: 'development',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.environment).toBe('development');
    });

    test('returns 404 when no credentials to update', async () => {
      const storeId = createTestId();

      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .put('/api/credentials')
        .set(authHeader)
        .send({
          storeId,
          baseUrl: 'https://new-url.example.com',
        });

      expect(res.status).toBe(404);
    });
  });

  // ======================================================================
  // POST /api/credentials/test
  // ======================================================================

  describe('POST /api/credentials/test', () => {
    test('returns success on valid credentials', async () => {
      const storeId = createTestId();
      const credential = createMockCredential({ store_id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [credential] });
      // markValid
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/credentials/test')
        .set(authHeader)
        .send({ storeId });

      expect(res.status).toBe(200);
      expect(res.body.data.connected).toBe(true);
      expect(res.body.data.message).toBe('Successfully connected to Oracle instance');
      expect(res.body.data.lastTestedAt).toBeDefined();
    });

    test('returns 404 when no credentials to test', async () => {
      const storeId = createTestId();

      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/credentials/test')
        .set(authHeader)
        .send({ storeId });

      expect(res.status).toBe(404);
    });

    test('updates is_valid flag after test', async () => {
      const storeId = createTestId();
      const credential = createMockCredential({ store_id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [credential] });
      // markValid
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/api/credentials/test')
        .set(authHeader)
        .send({ storeId });

      const updateCall = mockQuery.mock.calls.find(
        (call: any) =>
          call[0].toLowerCase().includes('update oracle_credentials') &&
          call[0].toLowerCase().includes('is_valid')
      );
      expect(updateCall).toBeDefined();
    });
  });

  // ======================================================================
  // DELETE /api/credentials
  // ======================================================================

  describe('DELETE /api/credentials', () => {
    test('removes stored credentials', async () => {
      const storeId = createTestId();
      const credential = createMockCredential({ store_id: storeId });

      mockQuery.mockResolvedValueOnce({ rows: [credential] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .delete('/api/credentials')
        .set(authHeader)
        .send({ storeId });

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Oracle credentials deleted successfully');
    });

    test('returns 404 when no credentials to delete', async () => {
      const storeId = createTestId();

      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .delete('/api/credentials')
        .set(authHeader)
        .send({ storeId });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
