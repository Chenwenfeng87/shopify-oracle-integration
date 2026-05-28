// ============================================================================
// Worker Test Setup
// ============================================================================
// Configures environment variables, mocks external dependencies (pg, ioredis,
// amqplib, axios), and provides test fixtures for worker tests.

import { v4 as uuidv4 } from 'uuid';
import type { SyncQueueMessage } from '../src/types';

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/worker_test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.RABBITMQ_URL = 'amqp://localhost:5672';
process.env.MAX_RETRIES = '3';
process.env.RABBITMQ_PREFETCH = '10';

// ---------------------------------------------------------------------------
// Mock pg
// ---------------------------------------------------------------------------

const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
  connect: jest.fn(),
  end: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
};

jest.mock('pg', () => {
  const actual = jest.requireActual('pg');
  return {
    ...actual,
    Pool: jest.fn(() => mockPool),
  };
});

// ---------------------------------------------------------------------------
// Mock ioredis
// ---------------------------------------------------------------------------

const mockRedisInstance = {
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
  return jest.fn(() => mockRedisInstance);
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
  defaults: {},
};

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return {
    ...actual,
    create: jest.fn(() => mockAxiosInstance),
    default: {
      ...actual.default,
      create: jest.fn(() => mockAxiosInstance),
    },
  };
});

// ---------------------------------------------------------------------------
// Logger mock
// ---------------------------------------------------------------------------

jest.mock('../src/logger', () => ({
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
  createEntityLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

export function createTestId(): string {
  return uuidv4();
}

/**
 * Create a valid SyncQueueMessage fixture for item sync.
 */
export function createItemSyncMessage(
  overrides: Partial<SyncQueueMessage> = {}
): SyncQueueMessage {
  return {
    jobId: overrides.jobId || createTestId(),
    storeId: overrides.storeId || createTestId(),
    entityType: 'item',
    direction: 'oracle_to_shopify',
    trigger: 'manual',
    records: overrides.records || [
      {
        id: 'rec-1',
        data: {
          ItemId: 1001,
          ItemNumber: 'SKU-001',
          ItemDescription: 'Test Widget',
          ItemType: 'Finished Good',
          PrimaryUOMCode: 'EA',
          OrganizationId: 101,
          ItemStatus: 'Active',
          ListPrice: 29.99,
          CurrencyCode: 'USD',
          WeightValue: 1.5,
          WeightUOMCode: 'LB',
          InventoryTrackedFlag: true,
        },
      },
    ],
    config: overrides.config || {
      id: createTestId(),
      store_id: overrides.storeId || createTestId(),
      entity_type: 'item',
      frequency: 'real_time',
      cron_expression: null,
      is_enabled: true,
      batch_size: 100,
      conflict_strategy: 'source_wins',
      created_at: new Date(),
      updated_at: new Date(),
    },
    mappings: overrides.mappings || [
      {
        id: createTestId(),
        store_id: overrides.storeId || createTestId(),
        entity_type: 'item',
        direction: 'oracle_to_shopify',
        shopify_field: 'title',
        oracle_field: 'ItemDescription',
        transform_rule: null,
        is_required: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: createTestId(),
        store_id: overrides.storeId || createTestId(),
        entity_type: 'item',
        direction: 'oracle_to_shopify',
        shopify_field: 'sku',
        oracle_field: 'ItemNumber',
        transform_rule: null,
        is_required: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: createTestId(),
        store_id: overrides.storeId || createTestId(),
        entity_type: 'item',
        direction: 'oracle_to_shopify',
        shopify_field: 'price',
        oracle_field: 'ListPrice',
        transform_rule: null,
        is_required: false,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ],
    timestamp: overrides.timestamp || new Date().toISOString(),
    retryCount: overrides.retryCount || 0,
  };
}

/**
 * Create a valid SyncQueueMessage fixture for customer sync.
 */
export function createCustomerSyncMessage(
  overrides: Partial<SyncQueueMessage> = {}
): SyncQueueMessage {
  return {
    jobId: overrides.jobId || createTestId(),
    storeId: overrides.storeId || createTestId(),
    entityType: 'customer',
    direction: 'shopify_to_oracle',
    trigger: 'webhook',
    records: overrides.records || [
      {
        id: 'rec-1',
        data: {
          id: 555001,
          email: 'john.doe@example.com',
          first_name: 'John',
          last_name: 'Doe',
          phone: '+1-555-123-4567',
          verified_email: true,
          currency: 'USD',
          tax_exempt: false,
          tags: 'wholesale',
          note: 'Preferred customer',
          addresses: [
            {
              id: 1,
              address1: '123 Main St',
              address2: 'Suite 100',
              city: 'Portland',
              province: 'Oregon',
              country: 'US',
              zip: '97201',
              phone: '+1-555-123-4567',
              default: true,
            },
          ],
          default_address: {
            id: 1,
            address1: '123 Main St',
            city: 'Portland',
            province: 'Oregon',
            country: 'US',
            zip: '97201',
          },
        },
      },
    ],
    config: overrides.config || {
      id: createTestId(),
      store_id: overrides.storeId || createTestId(),
      entity_type: 'customer',
      frequency: 'real_time',
      cron_expression: null,
      is_enabled: true,
      batch_size: 100,
      conflict_strategy: 'source_wins',
      created_at: new Date(),
      updated_at: new Date(),
    },
    mappings: overrides.mappings || [
      {
        id: createTestId(),
        store_id: overrides.storeId || createTestId(),
        entity_type: 'customer',
        direction: 'shopify_to_oracle',
        shopify_field: 'email',
        oracle_field: 'EmailAddress',
        transform_rule: null,
        is_required: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: createTestId(),
        store_id: overrides.storeId || createTestId(),
        entity_type: 'customer',
        direction: 'shopify_to_oracle',
        shopify_field: 'first_name',
        oracle_field: 'PartyName',
        transform_rule: {
          type: 'concat',
          config: { fields: ['first_name', 'last_name'], separator: ' ' },
        },
        is_required: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ],
    timestamp: overrides.timestamp || new Date().toISOString(),
    retryCount: overrides.retryCount || 0,
  };
}

/**
 * Create a valid SyncQueueMessage fixture for order sync.
 */
export function createOrderSyncMessage(
  overrides: Partial<SyncQueueMessage> = {}
): SyncQueueMessage {
  return {
    jobId: overrides.jobId || createTestId(),
    storeId: overrides.storeId || createTestId(),
    entityType: 'order',
    direction: 'shopify_to_oracle',
    trigger: 'webhook',
    records: overrides.records || [
      {
        id: 'rec-1',
        data: {
          id: 1002003,
          order_number: 2045,
          name: '#2045',
          email: 'buyer@example.com',
          financial_status: 'paid',
          fulfillment_status: null,
          total_price: '250.00',
          subtotal_price: '200.00',
          total_tax: '20.00',
          total_discounts: '10.00',
          currency: 'USD',
          note: 'Handle with care',
          discount_codes: [{ code: 'SAVE10', amount: '10.00', type: 'fixed_amount' }],
          line_items: [
            {
              id: 1,
              variant_id: 5001,
              title: 'Widget A',
              quantity: 2,
              sku: 'WGT-A',
              price: '75.00',
              total_discount: '5.00',
              tax_lines: [{ price: '7.50', rate: 0.1, title: 'Sales Tax' }],
            },
            {
              id: 2,
              variant_id: 5002,
              title: 'Widget B',
              quantity: 1,
              sku: 'WGT-B',
              price: '50.00',
              total_discount: '0.00',
              tax_lines: [],
            },
          ],
          shipping_address: {
            address1: '456 Oak Ave',
            city: 'Seattle',
            province: 'Washington',
            country: 'US',
            zip: '98101',
          },
          billing_address: {
            address1: '456 Oak Ave',
            city: 'Seattle',
            province: 'Washington',
            country: 'US',
            zip: '98101',
          },
          customer: {
            id: 555001,
            email: 'buyer@example.com',
            first_name: 'Jane',
            last_name: 'Buyer',
          },
          created_at: '2024-01-15T10:30:00Z',
          processed_at: '2024-01-15T10:30:00Z',
          cancelled_at: null,
        },
      },
    ],
    config: overrides.config || {
      id: createTestId(),
      store_id: overrides.storeId || createTestId(),
      entity_type: 'order',
      frequency: 'real_time',
      cron_expression: null,
      is_enabled: true,
      batch_size: 100,
      conflict_strategy: 'source_wins',
      created_at: new Date(),
      updated_at: new Date(),
    },
    mappings: overrides.mappings || [
      {
        id: createTestId(),
        store_id: overrides.storeId || createTestId(),
        entity_type: 'order',
        direction: 'shopify_to_oracle',
        shopify_field: 'name',
        oracle_field: 'SourceOrderNumber',
        transform_rule: null,
        is_required: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: createTestId(),
        store_id: overrides.storeId || createTestId(),
        entity_type: 'order',
        direction: 'shopify_to_oracle',
        shopify_field: 'currency',
        oracle_field: 'TransactionalCurrencyCode',
        transform_rule: null,
        is_required: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: createTestId(),
        store_id: overrides.storeId || createTestId(),
        entity_type: 'order',
        direction: 'shopify_to_oracle',
        shopify_field: 'total_price',
        oracle_field: 'TotalAmount',
        transform_rule: null,
        is_required: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ],
    timestamp: overrides.timestamp || new Date().toISOString(),
    retryCount: overrides.retryCount || 0,
  };
}

/**
 * Create a valid SyncQueueMessage fixture for inventory sync.
 */
export function createInventorySyncMessage(
  overrides: Partial<SyncQueueMessage> = {}
): SyncQueueMessage {
  return {
    jobId: overrides.jobId || createTestId(),
    storeId: overrides.storeId || createTestId(),
    entityType: 'inventory',
    direction: 'oracle_to_shopify',
    trigger: 'scheduled',
    records: overrides.records || [
      {
        id: 'rec-1',
        data: {
          ItemId: 1001,
          ItemNumber: 'SKU-001',
          OrganizationId: 101,
          OrganizationCode: 'WH-MAIN',
          SubinventoryCode: 'STOCK',
          OnHandQuantity: 150,
          ReservedQuantity: 10,
          AvailableQuantity: 140,
          UOMCode: 'EA',
          LastUpdateDate: '2024-01-15T12:00:00Z',
        },
      },
    ],
    config: overrides.config || {
      id: createTestId(),
      store_id: overrides.storeId || createTestId(),
      entity_type: 'inventory',
      frequency: 'scheduled',
      cron_expression: '*/15 * * * *',
      is_enabled: true,
      batch_size: 100,
      conflict_strategy: 'source_wins',
      created_at: new Date(),
      updated_at: new Date(),
    },
    mappings: overrides.mappings || [
      {
        id: createTestId(),
        store_id: overrides.storeId || createTestId(),
        entity_type: 'inventory',
        direction: 'oracle_to_shopify',
        shopify_field: 'sku',
        oracle_field: 'ItemNumber',
        transform_rule: null,
        is_required: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: createTestId(),
        store_id: overrides.storeId || createTestId(),
        entity_type: 'inventory',
        direction: 'oracle_to_shopify',
        shopify_field: 'inventory_quantity',
        oracle_field: 'OnHandQuantity',
        transform_rule: null,
        is_required: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ],
    timestamp: overrides.timestamp || new Date().toISOString(),
    retryCount: overrides.retryCount || 0,
  };
}

/**
 * Helper to create a mock ConsumeMessage for testing consumers.
 */
export function createMockConsumeMessage(
  content: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
): any {
  const contentBuffer = Buffer.from(JSON.stringify(content));
  return {
    content: contentBuffer,
    fields: {
      exchange: 'sync.exchange',
      routingKey: (overrides.routingKey as string) || 'sync.items.queue',
      deliveryTag: (overrides.deliveryTag as number) || 1,
    },
    properties: {
      messageId: (overrides.messageId as string) || uuidv4(),
      headers: overrides.headers || {},
      contentType: 'application/json',
      deliveryMode: 2,
      priority: 0,
      timestamp: Math.floor(Date.now() / 1000),
    },
  };
}

/**
 * Reset all mocks between tests.
 */
export function resetMocks(): void {
  mockQuery.mockReset();
  mockRedisInstance.get.mockReset();
  mockRedisInstance.set.mockReset();
  mockRedisInstance.del.mockReset();
  mockRedisInstance.incr.mockReset();
  mockRedisInstance.expire.mockReset();
  mockChannel.ack.mockClear();
  mockChannel.nack.mockClear();
  mockChannel.publish.mockClear();
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
  mockPool,
  mockRedisInstance,
  mockChannel,
  mockConnection,
  mockAxiosInstance,
};
