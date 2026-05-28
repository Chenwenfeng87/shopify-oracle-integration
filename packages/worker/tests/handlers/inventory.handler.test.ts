// ============================================================================
// InventoryHandler Tests
// ============================================================================

import {
  mockQuery,
  mockAxiosInstance,
  createTestId,
  createInventorySyncMessage,
} from '../setup';

jest.mock('../../src/logger', () => ({
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

import { InventoryHandler } from '../../src/handlers/inventory.handler';

describe('InventoryHandler', () => {
  let handler: InventoryHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new InventoryHandler();
  });

  test('fetches inventory from Oracle and updates Shopify', async () => {
    const storeId = createTestId();
    const message = createInventorySyncMessage({
      storeId,
      direction: 'oracle_to_shopify',
      records: [
        {
          id: 'rec-1',
          data: {
            ItemId: 1001,
            ItemNumber: 'SKU-001',
            OrganizationCode: 'WH-MAIN',
            OnHandQuantity: 150,
            AvailableQuantity: 140,
          },
        },
      ],
    });

    // Store lookup
    mockQuery.mockResolvedValueOnce({
      rows: [{
        shopify_domain: 'test-store.myshopify.com',
        access_token: 'test-shopify-token',
      }],
    });

    // Oracle credentials
    mockQuery.mockResolvedValueOnce({
      rows: [{
        base_url: 'https://oracle-test.example.com',
        username: 'oracle_user',
        password: 'oracle_pass',
        identity_domain: null,
      }],
    });

    // Oracle auth
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { token: 'oracle-bearer-token' },
    });

    // Step 1: Find variant by SKU
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        variants: [
          {
            id: 5001,
            product_id: 100,
            sku: 'SKU-001',
            inventory_item_id: 9001,
            inventory_quantity: 100,
          },
        ],
      },
    });

    // Step 2: Get inventory level to find location ID
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        inventory_levels: [
          {
            inventory_item_id: 9001,
            location_id: 7001,
            available: 100,
          },
        ],
      },
    });

    // Step 3: Set inventory level
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: {
        inventory_level: {
          inventory_item_id: 9001,
          location_id: 7001,
          available: 150,
        },
      },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] }); // sync log
    mockQuery.mockResolvedValueOnce({ rows: [] }); // update progress

    await handler.process(message);

    // Should have set the inventory level
    const setCall = mockAxiosInstance.post.mock.calls.find(
      (call: any) => call[0] === '/inventory_levels/set.json'
    );
    expect(setCall).toBeDefined();
    expect(setCall[1].location_id).toBe(7001);
    expect(setCall[1].inventory_item_id).toBe(9001);
    expect(setCall[1].available).toBe(150);
  });

  test('handles multiple locations', async () => {
    const storeId = createTestId();
    const message = createInventorySyncMessage({
      storeId,
      direction: 'oracle_to_shopify',
      records: [
        {
          id: 'rec-1',
          data: {
            ItemId: 1001,
            ItemNumber: 'SKU-MULTI',
            OrganizationCode: 'WH-EAST',
            OnHandQuantity: 200,
            AvailableQuantity: 195,
          },
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        shopify_domain: 'test-store.myshopify.com',
        access_token: 'test-shopify-token',
      }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        base_url: 'https://oracle-test.example.com',
        username: 'oracle_user',
        password: 'oracle_pass',
        identity_domain: null,
      }],
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { token: 'oracle-token' },
    });

    // Variant found
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        variants: [
          {
            id: 5002,
            inventory_item_id: 9002,
            sku: 'SKU-MULTI',
          },
        ],
      },
    });

    // Existing inventory level
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        inventory_levels: [
          {
            inventory_item_id: 9002,
            location_id: 7002,
            available: 100,
          },
        ],
      },
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: {
        inventory_level: {
          inventory_item_id: 9002,
          location_id: 7002,
          available: 200,
        },
      },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);

    const setCall = mockAxiosInstance.post.mock.calls.find(
      (call: any) => call[0] === '/inventory_levels/set.json'
    );
    expect(setCall).toBeDefined();
    expect(setCall[1].available).toBe(200);
  });

  test('sets inventory to 0 when Oracle shows 0', async () => {
    const storeId = createTestId();
    const message = createInventorySyncMessage({
      storeId,
      direction: 'oracle_to_shopify',
      records: [
        {
          id: 'rec-1',
          data: {
            ItemId: 1001,
            ItemNumber: 'SKU-ZERO',
            OrganizationCode: 'WH-MAIN',
            OnHandQuantity: 0,
            AvailableQuantity: 0,
          },
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        shopify_domain: 'test-store.myshopify.com',
        access_token: 'test-shopify-token',
      }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        base_url: 'https://oracle-test.example.com',
        username: 'oracle_user',
        password: 'oracle_pass',
        identity_domain: null,
      }],
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { token: 'oracle-token' },
    });

    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        variants: [{ id: 5003, inventory_item_id: 9003, sku: 'SKU-ZERO' }],
      },
    });

    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        inventory_levels: [
          { inventory_item_id: 9003, location_id: 7003, available: 25 },
        ],
      },
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: {
        inventory_level: {
          inventory_item_id: 9003,
          location_id: 7003,
          available: 0,
        },
      },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);

    const setCall = mockAxiosInstance.post.mock.calls.find(
      (call: any) => call[0] === '/inventory_levels/set.json'
    );
    expect(setCall).toBeDefined();
    expect(setCall[1].available).toBe(0);
  });

  test('handles items not tracked in Shopify', async () => {
    const storeId = createTestId();
    const message = createInventorySyncMessage({
      storeId,
      direction: 'oracle_to_shopify',
      records: [
        {
          id: 'rec-1',
          data: {
            ItemId: 1001,
            ItemNumber: 'SKU-NOT-TRACKED',
            OrganizationCode: 'WH-MAIN',
            OnHandQuantity: 50,
          },
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        shopify_domain: 'test-store.myshopify.com',
        access_token: 'test-shopify-token',
      }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        base_url: 'https://oracle-test.example.com',
        username: 'oracle_user',
        password: 'oracle_pass',
        identity_domain: null,
      }],
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { token: 'oracle-token' },
    });

    // No variant found by SKU
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: { variants: [] },
    });

    // processRecord catches the error
    mockQuery.mockResolvedValueOnce({ rows: [] }); // sync log for error
    mockQuery.mockResolvedValueOnce({ rows: [] }); // update progress

    await handler.process(message);

    // Should not have attempted to set inventory
    const setCall = mockAxiosInstance.post.mock.calls.find(
      (call: any) => call[0] === '/inventory_levels/set.json'
    );
    expect(setCall).toBeUndefined();

    // Should have logged the error
    const logCall = mockQuery.mock.calls.find(
      (call: any) => call[0].includes('INSERT INTO sync_logs')
    );
    expect(logCall).toBeDefined();
    expect(logCall[1][7]).toContain('not found in Shopify');
  });

  test('connects inventory levels when needed', async () => {
    const storeId = createTestId();
    const message = createInventorySyncMessage({
      storeId,
      direction: 'oracle_to_shopify',
      records: [
        {
          id: 'rec-1',
          data: {
            ItemId: 1001,
            ItemNumber: 'SKU-NEWLOC',
            OrganizationCode: 'WH-NEW',
            OnHandQuantity: 75,
          },
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        shopify_domain: 'test-store.myshopify.com',
        access_token: 'test-shopify-token',
      }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        base_url: 'https://oracle-test.example.com',
        username: 'oracle_user',
        password: 'oracle_pass',
        identity_domain: null,
      }],
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { token: 'oracle-token' },
    });

    // Variant found
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        variants: [{ id: 5004, inventory_item_id: 9004, sku: 'SKU-NEWLOC' }],
      },
    });

    // No existing inventory level
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: { inventory_levels: [] },
    });

    // Fetch locations
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        locations: [{ id: 7004, name: 'Main Warehouse' }],
      },
    });

    // Connect inventory item to location
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: {
        inventory_level: {
          inventory_item_id: 9004,
          location_id: 7004,
          available: 75,
        },
      },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);

    // Should have connected the inventory level at the new location
    const connectCall = mockAxiosInstance.post.mock.calls.find(
      (call: any) => call[0] === '/inventory_levels.json'
    );
    expect(connectCall).toBeDefined();
    expect(connectCall[1].location_id).toBe(7004);
    expect(connectCall[1].inventory_item_id).toBe(9004);
    expect(connectCall[1].available).toBe(75);
  });

  test('handles Oracle to Shopify sync with errors', async () => {
    const storeId = createTestId();
    const message = createInventorySyncMessage({
      storeId,
      direction: 'oracle_to_shopify',
      records: [
        {
          id: 'rec-1',
          data: {
            ItemNumber: '', // Missing SKU
            OnHandQuantity: 100,
          },
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        shopify_domain: 'test-store.myshopify.com',
        access_token: 'test-shopify-token',
      }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        base_url: 'https://oracle-test.example.com',
        username: 'oracle_user',
        password: 'oracle_pass',
        identity_domain: null,
      }],
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { token: 'oracle-token' },
    });

    // processRecord catches the SKU error
    mockQuery.mockResolvedValueOnce({ rows: [] }); // sync log
    mockQuery.mockResolvedValueOnce({ rows: [] }); // update progress

    await handler.process(message);

    const logCall = mockQuery.mock.calls.find(
      (call: any) => call[0].includes('INSERT INTO sync_logs')
    );
    expect(logCall).toBeDefined();
    expect(logCall[1][7]).toBe('SKU is required for inventory sync');
  });

  test('handles negative inventory values as errors', async () => {
    const storeId = createTestId();
    const message = createInventorySyncMessage({
      storeId,
      direction: 'oracle_to_shopify',
      records: [
        {
          id: 'rec-1',
          data: {
            ItemNumber: 'SKU-NEG',
            OnHandQuantity: -5,
          },
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        shopify_domain: 'test-store.myshopify.com',
        access_token: 'test-shopify-token',
      }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        base_url: 'https://oracle-test.example.com',
        username: 'oracle_user',
        password: 'oracle_pass',
        identity_domain: null,
      }],
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { token: 'oracle-token' },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] }); // sync log
    mockQuery.mockResolvedValueOnce({ rows: [] }); // update progress

    await handler.process(message);

    const logCall = mockQuery.mock.calls.find(
      (call: any) => call[0].includes('INSERT INTO sync_logs')
    );
    expect(logCall).toBeDefined();
    expect(logCall[1][7]).toContain('Valid inventory_quantity is required');
  });
});
