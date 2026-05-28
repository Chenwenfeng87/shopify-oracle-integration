// ============================================================================
// Backend Test Setup
// ============================================================================
// Configures environment variables, mocks external dependencies (pg, ioredis,
// amqplib, axios), and provides test database helpers for integration tests.

import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Environment variables – set BEFORE any module imports read config
// ---------------------------------------------------------------------------

process.env.NODE_ENV = 'test';
process.env.SHOPIFY_API_KEY = 'test-shopify-api-key';
process.env.SHOPIFY_API_SECRET = 'test-shopify-api-secret-0123456789abcdef';
process.env.SHOPIFY_SCOPES = 'read_products,write_products,read_customers,write_customers,read_orders,write_orders,read_inventory,write_inventory';
process.env.SHOPIFY_APP_URL = 'https://test-app.example.com';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.RABBITMQ_URL = 'amqp://localhost:5672';
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abc';
process.env.LOG_LEVEL = 'silent';

// ---------------------------------------------------------------------------
// Mock pg (node-postgres)
// ---------------------------------------------------------------------------

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockRelease = jest.fn();
const mockClient = { query: mockQuery, release: mockRelease };
const mockPool = {
  query: mockQuery,
  connect: mockConnect,
  end: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
};

jest.mock('pg', () => {
  const actualPool = jest.requireActual('pg');
  return {
    ...actualPool,
    Pool: jest.fn(() => mockPool),
  };
});

// ---------------------------------------------------------------------------
// Mock ioredis
// ---------------------------------------------------------------------------

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  quit: jest.fn().mockResolvedValue(undefined),
  connect: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  status: 'ready',
};

jest.mock('ioredis', () => {
  return jest.fn(() => mockRedis);
});

// ---------------------------------------------------------------------------
// Mock amqplib
// ---------------------------------------------------------------------------

const mockChannel = {
  assertExchange: jest.fn().mockResolvedValue(undefined),
  assertQueue: jest.fn().mockResolvedValue(undefined),
  bindQueue: jest.fn().mockResolvedValue(undefined),
  publish: jest.fn().mockReturnValue(true),
  consume: jest.fn(),
  ack: jest.fn(),
  nack: jest.fn(),
  prefetch: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
  checkQueue: jest.fn().mockResolvedValue({ messageCount: 0, consumerCount: 0 }),
};

const mockConnection = {
  createChannel: jest.fn().mockResolvedValue(mockChannel),
  close: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
};

jest.mock('amqplib', () => ({
  connect: jest.fn().mockResolvedValue(mockConnection),
}));

// ---------------------------------------------------------------------------
// Mock axios
// ---------------------------------------------------------------------------

const mockAxiosInstance = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
  request: jest.fn(),
  interceptors: {
    request: { use: jest.fn(), eject: jest.fn() },
    response: { use: jest.fn(), eject: jest.fn() },
  },
};

jest.mock('axios', () => {
  const actualAxios = jest.requireActual('axios');
  return {
    ...actualAxios,
    create: jest.fn(() => mockAxiosInstance),
    default: {
      ...actualAxios.default,
      create: jest.fn(() => mockAxiosInstance),
    },
  };
});

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a valid UUID for use in tests.
 */
export function createTestId(): string {
  return uuidv4();
}

/**
 * Create a mock store row payload for use with StoreModel mocks.
 */
export function createMockStore(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id || createTestId(),
    shopify_domain: overrides.shopify_domain || 'test-store.myshopify.com',
    shopify_token: overrides.shopify_token || 'test-access-token-123',
    shopify_api_key: overrides.shopify_api_key || 'test-shopify-api-key',
    is_active: overrides.is_active !== undefined ? overrides.is_active : true,
    installed_at: overrides.installed_at || now,
    uninstalled_at: overrides.uninstalled_at || null,
    created_at: overrides.created_at || now,
    updated_at: overrides.updated_at || now,
  };
}

/**
 * Create a mock sync job row payload.
 */
export function createMockSyncJob(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id || createTestId(),
    store_id: overrides.store_id || createTestId(),
    entity_type: overrides.entity_type || 'item',
    direction: overrides.direction || 'shopify_to_oracle',
    status: overrides.status || 'pending',
    trigger: overrides.trigger || 'manual',
    total_records: overrides.total_records || 0,
    processed_records: overrides.processed_records || 0,
    failed_records: overrides.failed_records || 0,
    started_at: overrides.started_at || null,
    completed_at: overrides.completed_at || null,
    error_summary: overrides.error_summary || null,
    created_at: overrides.created_at || now,
    updated_at: overrides.updated_at || now,
  };
}

/**
 * Create a mock field mapping row payload.
 */
export function createMockMapping(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id || createTestId(),
    store_id: overrides.store_id || createTestId(),
    entity_type: overrides.entity_type || 'item',
    direction: overrides.direction || 'shopify_to_oracle',
    shopify_field: overrides.shopify_field || 'title',
    oracle_field: overrides.oracle_field || 'ItemDescription',
    transform_rule: overrides.transform_rule || null,
    is_required: overrides.is_required !== undefined ? overrides.is_required : false,
    created_at: overrides.created_at || now,
    updated_at: overrides.updated_at || now,
  };
}

/**
 * Create a mock credential row payload.
 */
export function createMockCredential(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id || createTestId(),
    store_id: overrides.store_id || createTestId(),
    encrypted_username: overrides.encrypted_username || 'encrypted_username_hex',
    encrypted_password: overrides.encrypted_password || 'encrypted_password_hex',
    encryption_iv: overrides.encryption_iv || 'test_iv_hex',
    encryption_tag: overrides.encryption_tag || 'test_tag_hex',
    base_url: overrides.base_url || 'https://oracle-test.example.com',
    environment: overrides.environment || 'test',
    is_valid: overrides.is_valid !== undefined ? overrides.is_valid : true,
    last_tested_at: overrides.last_tested_at || null,
    created_at: overrides.created_at || now,
    updated_at: overrides.updated_at || now,
  };
}

/**
 * Create a mock sync log row payload.
 */
export function createMockSyncLog(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: overrides.id || createTestId(),
    sync_job_id: overrides.sync_job_id || createTestId(),
    record_id: overrides.record_id || createTestId(),
    action: overrides.action || 'created',
    source_data: overrides.source_data || null,
    target_data: overrides.target_data || null,
    conflict_detected: overrides.conflict_detected || false,
    conflict_resolution: overrides.conflict_resolution || null,
    error_message: overrides.error_message || null,
    created_at: overrides.created_at || now,
  };
}

/**
 * Reset all mocks between tests.
 */
export function resetMocks(): void {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockRedis.get.mockReset();
  mockRedis.set.mockReset();
  mockRedis.del.mockReset();
  mockRedis.incr.mockReset();
  mockRedis.expire.mockReset();
  mockAxiosInstance.get.mockReset();
  mockAxiosInstance.post.mockReset();
  mockAxiosInstance.put.mockReset();
  mockAxiosInstance.patch.mockReset();
  mockAxiosInstance.delete.mockReset();
}

// ---------------------------------------------------------------------------
// Global Hooks
// ---------------------------------------------------------------------------

beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick'] });
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  resetMocks();
});

export {
  mockQuery,
  mockConnect,
  mockClient,
  mockPool,
  mockRedis,
  mockChannel,
  mockConnection,
  mockAxiosInstance,
};
