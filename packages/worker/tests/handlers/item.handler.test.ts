// ============================================================================
// ItemHandler Tests
// ============================================================================

import {
  mockQuery,
  mockAxiosInstance,
  createTestId,
  createItemSyncMessage,
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

import { ItemHandler } from '../../src/handlers/item.handler';

describe('ItemHandler', () => {
  let handler: ItemHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new ItemHandler();
  });

  test('fetches items from Oracle and creates in Shopify', async () => {
    const storeId = createTestId();
    const message = createItemSyncMessage({
      storeId,
      direction: 'oracle_to_shopify',
      records: [
        {
          id: 'rec-1',
          data: {
            ItemId: 1001,
            ItemNumber: 'SKU-NEW-001',
            ItemDescription: 'New Widget',
            ListPrice: 49.99,
          },
        },
      ],
    });

    // Mock store lookup
    mockQuery.mockResolvedValueOnce({
      rows: [{
        shopify_domain: 'test-store.myshopify.com',
        access_token: 'test-shopify-token',
      }],
    });

    // Mock Oracle credentials
    mockQuery.mockResolvedValueOnce({
      rows: [{
        base_url: 'https://oracle-test.example.com',
        username: 'oracle_user',
        password: 'oracle_pass',
        identity_domain: null,
      }],
    });

    // Mock Oracle auth response
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { token: 'oracle-bearer-token', access_token: 'oracle-bearer-token' },
    });

    // Mock Shopify: no existing product by SKU
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: { products: [] },
    });

    // Mock Shopify: create product
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: {
        product: {
          id: 999888,
          title: 'New Widget',
          sku: 'SKU-NEW-001',
          status: 'active',
        },
      },
    });

    // Mock sync log insert
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Mock updateJobProgress
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);

    // Should have created the product in Shopify
    const createCall = mockAxiosInstance.post.mock.calls.find(
      (call: any) => call[0] === '/products.json'
    );
    expect(createCall).toBeDefined();
    expect(createCall[1].product.title).toBe('New Widget');
    expect(createCall[1].product.sku).toBe('SKU-NEW-001');

    // Should have updated job progress
    const updateProgressCall = mockQuery.mock.calls.find(
      (call: any) => call[0].includes('UPDATE sync_jobs')
    );
    expect(updateProgressCall).toBeDefined();
  });

  test('updates existing products in Shopify', async () => {
    const storeId = createTestId();
    const message = createItemSyncMessage({
      storeId,
      direction: 'oracle_to_shopify',
      records: [
        {
          id: 'rec-1',
          data: {
            ItemId: 1001,
            ItemNumber: 'SKU-EXISTING',
            ItemDescription: 'Updated Widget Name',
            ListPrice: 39.99,
            ItemStatus: 'Active',
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

    // Oracle auth
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { token: 'oracle-token' },
    });

    // Shopify: existing product found
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        products: [
          {
            id: 555444,
            title: 'Original Widget',
            variants: [{ id: 111222, price: '29.99' }],
          },
        ],
      },
    });

    // Shopify: update product
    mockAxiosInstance.put.mockResolvedValueOnce({
      data: {
        product: {
          id: 555444,
          title: 'Updated Widget Name',
          status: 'active',
        },
      },
    });

    // Shopify: update variant price
    mockAxiosInstance.put.mockResolvedValueOnce({
      data: { variant: { id: 111222, price: '39.99' } },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);

    // Should have UPDATED, not created
    const updateCall = mockAxiosInstance.put.mock.calls.find(
      (call: any) => call[0] === '/products/555444.json'
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1].product.title).toBe('Updated Widget Name');

    // Should have updated the variant price
    const variantUpdateCall = mockAxiosInstance.put.mock.calls.find(
      (call: any) => call[0] === '/variants/111222.json'
    );
    expect(variantUpdateCall).toBeDefined();
    expect(variantUpdateCall[1].variant.price).toBe('39.99');
  });

  test('transforms data using field mappings', async () => {
    const storeId = createTestId();
    const message = createItemSyncMessage({
      storeId,
      direction: 'oracle_to_shopify',
      mappings: [
        {
          id: createTestId(),
          store_id: storeId,
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
          store_id: storeId,
          entity_type: 'item',
          direction: 'oracle_to_shopify',
          shopify_field: 'sku',
          oracle_field: 'ItemNumber',
          transform_rule: null,
          is_required: true,
          created_at: new Date(),
          updated_at: new Date(),
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

    // No existing product
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: { products: [] },
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { product: { id: 777888, title: 'Mapped Title', sku: 'MAPPED-SKU' } },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);

    // Check that the transformed data was used
    const createCall = mockAxiosInstance.post.mock.calls.find(
      (call: any) => call[0] === '/products.json'
    );
    expect(createCall).toBeDefined();
    expect(createCall[1].product.title).toBeDefined();
    expect(createCall[1].product.sku).toBe('SKU-001');
  });

  test('handles API errors for individual records', async () => {
    const storeId = createTestId();
    const message = createItemSyncMessage({
      storeId,
      direction: 'oracle_to_shopify',
      records: [
        {
          id: 'rec-1',
          data: {
            ItemId: 1001,
            ItemNumber: 'SKU-001',
            ItemDescription: 'Widget A',
          },
        },
        {
          id: 'rec-2',
          data: {
            ItemId: 1002,
            ItemNumber: 'SKU-002',
            ItemDescription: 'Widget B',
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

    // First product: succeeds
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { products: [] } });
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { product: { id: 1, title: 'Widget A' } },
    });

    // Second product: fails
    mockAxiosInstance.get.mockResolvedValueOnce({ data: { products: [] } });
    mockAxiosInstance.post.mockRejectedValueOnce(new Error('Shopify rate limited'));

    // Sync log for first record (success)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Sync log for second record (failure)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Update job progress
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);

    // Should have recorded 1 success and 1 failure
    const updateCall = mockQuery.mock.calls.find(
      (call: any) => call[0].includes('UPDATE sync_jobs')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toContain('partial'); // status should be partial
  });

  test('logs results to database', async () => {
    const storeId = createTestId();
    const message = createItemSyncMessage({
      storeId,
      direction: 'oracle_to_shopify',
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

    mockAxiosInstance.get.mockResolvedValueOnce({ data: { products: [] } });
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { product: { id: 1, title: 'Test', sku: 'SKU-001' } },
    });

    // Sync log insert
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Job progress update
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);

    // Verify sync log was inserted
    const logInsertCall = mockQuery.mock.calls.find(
      (call: any) =>
        call[0].toLowerCase().includes('insert into sync_logs')
    );
    expect(logInsertCall).toBeDefined();
    expect(logInsertCall[1][2]).toBe('rec-1'); // recordId
    expect(logInsertCall[1][3]).toBe('created'); // action
  });

  test('handles empty fetch results', async () => {
    const storeId = createTestId();
    const message = createItemSyncMessage({
      storeId,
      direction: 'oracle_to_shopify',
      records: [],
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

    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);

    // Should complete without errors
    expect(mockAxiosInstance.get).not.toHaveBeenCalledWith(
      expect.stringContaining('/products.json')
    );
  });

  test('throws error when store not found', async () => {
    const storeId = createTestId();
    const message = createItemSyncMessage({ storeId });

    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(handler.process(message)).rejects.toThrow(
      `Store ${storeId} not found or inactive`
    );
  });

  test('throws error when access token not configured', async () => {
    const storeId = createTestId();
    const message = createItemSyncMessage({ storeId });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        shopify_domain: 'test-store.myshopify.com',
        access_token: null,
      }],
    });

    await expect(handler.process(message)).rejects.toThrow(
      `Shopify access token not configured for store ${storeId}`
    );
  });
});
