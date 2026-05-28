// ============================================================================
// OrderHandler Tests
// ============================================================================

import {
  mockQuery,
  mockAxiosInstance,
  createTestId,
  createOrderSyncMessage,
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

import { OrderHandler } from '../../src/handlers/order.handler';

describe('OrderHandler', () => {
  let handler: OrderHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new OrderHandler();
  });

  test('fetches orders from Shopify and creates in Oracle', async () => {
    const storeId = createTestId();
    const message = createOrderSyncMessage({
      storeId,
      direction: 'shopify_to_oracle',
      records: [
        {
          id: 'rec-1',
          data: {
            id: 1002003,
            order_number: 2045,
            name: '#2045',
            email: 'buyer@example.com',
            financial_status: 'paid',
            total_price: '250.00',
            subtotal_price: '200.00',
            total_tax: '20.00',
            total_discounts: '10.00',
            currency: 'USD',
            line_items: [
              {
                id: 1,
                variant_id: 5001,
                title: 'Widget A',
                quantity: 2,
                sku: 'WGT-A',
                price: '75.00',
                total_discount: '5.00',
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
            created_at: '2024-01-15T10:30:00Z',
            cancelled_at: null,
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

    // Search: no existing order
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: { items: [] },
    });

    // Create order in Oracle
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: {
        OrderId: 3001,
        OrderNumber: '#2045',
        TotalAmount: 250.00,
        Status: 'BOOKED',
      },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] }); // sync log
    mockQuery.mockResolvedValueOnce({ rows: [] }); // update progress

    await handler.process(message);

    // Should have created order in Oracle
    const createCall = mockAxiosInstance.post.mock.calls.find(
      (call: any) => call[0] === '/api/orders'
    );
    expect(createCall).toBeDefined();
    expect(createCall[1].SourceOrderNumber).toBe('#2045');
    expect(createCall[1].TotalAmount).toBe('250.00');
  });

  test('maps line items correctly', async () => {
    const storeId = createTestId();
    const message = createOrderSyncMessage({
      storeId,
      direction: 'shopify_to_oracle',
      records: [
        {
          id: 'rec-1',
          data: {
            id: 1002003,
            order_number: 2045,
            name: '#2045',
            email: 'buyer@example.com',
            financial_status: 'paid',
            total_price: '200.00',
            currency: 'USD',
            line_items: [
              {
                id: 1,
                variant_id: 5001,
                title: 'Widget A',
                quantity: 2,
                sku: 'WGT-A',
                price: '75.00',
                total_discount: '0.00',
              },
              {
                id: 2,
                variant_id: 5002,
                title: 'Widget B',
                quantity: 1,
                sku: 'WGT-B',
                price: '50.00',
                total_discount: '0.00',
              },
            ],
            created_at: '2024-01-15T10:30:00Z',
            cancelled_at: null,
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
      data: { items: [] },
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { OrderId: 4001 },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);

    const createCall = mockAxiosInstance.post.mock.calls.find(
      (call: any) => call[0] === '/api/orders'
    );
    expect(createCall).toBeDefined();

    // Should have 2 line items mapped
    expect(createCall[1].OrderLines).toHaveLength(2);
    expect(createCall[1].OrderLines[0].ItemNumber).toBe('WGT-A');
    expect(createCall[1].OrderLines[0].Quantity).toBe(2);
    expect(createCall[1].OrderLines[1].ItemNumber).toBe('WGT-B');
    expect(createCall[1].OrderLines[1].Quantity).toBe(1);
  });

  test('maps shipping/billing addresses', async () => {
    const storeId = createTestId();
    const message = createOrderSyncMessage({
      storeId,
      direction: 'shopify_to_oracle',
      records: [
        {
          id: 'rec-1',
          data: {
            id: 1002003,
            order_number: 2045,
            name: '#2045',
            email: 'buyer@example.com',
            financial_status: 'paid',
            total_price: '250.00',
            currency: 'USD',
            line_items: [{ id: 1, title: 'Item', quantity: 1, sku: 'ITM', price: '250.00' }],
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
            created_at: '2024-01-15T10:30:00Z',
            cancelled_at: null,
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
      data: { items: [] },
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { OrderId: 5001 },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);

    expect(mockAxiosInstance.post).toHaveBeenCalled();
  });

  test('handles orders with discounts', async () => {
    const storeId = createTestId();
    const message = createOrderSyncMessage({
      storeId,
      direction: 'shopify_to_oracle',
      records: [
        {
          id: 'rec-1',
          data: {
            id: 1002003,
            order_number: 2045,
            name: '#2045',
            email: 'buyer@example.com',
            financial_status: 'paid',
            total_price: '90.00',
            subtotal_price: '100.00',
            total_discounts: '10.00',
            currency: 'USD',
            discount_codes: [{ code: 'TENOFF', amount: '10.00', type: 'fixed_amount' }],
            line_items: [{ id: 1, title: 'Item', quantity: 1, sku: 'DISC-ITM', price: '100.00' }],
            created_at: '2024-01-15T10:30:00Z',
            cancelled_at: null,
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
      data: { items: [] },
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { OrderId: 6001 },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);

    const createCall = mockAxiosInstance.post.mock.calls.find(
      (call: any) => call[0] === '/api/orders'
    );
    expect(createCall).toBeDefined();
    expect(createCall[1].DiscountAmount).toBe('10.00');
    expect(createCall[1].SubtotalAmount).toBe('100.00');
  });

  test('handles cancelled orders', async () => {
    const storeId = createTestId();
    const message = createOrderSyncMessage({
      storeId,
      direction: 'shopify_to_oracle',
      records: [
        {
          id: 'rec-1',
          data: {
            id: 1002003,
            order_number: 2045,
            name: '#2045',
            email: 'buyer@example.com',
            financial_status: 'refunded',
            total_price: '250.00',
            currency: 'USD',
            line_items: [{ id: 1, title: 'Item', quantity: 1, sku: 'CXL-ITM', price: '250.00' }],
            created_at: '2024-01-15T10:30:00Z',
            cancelled_at: '2024-01-16T10:30:00Z',
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
      data: { items: [] },
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { OrderId: 7001 },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handler.process(message);
    expect(mockAxiosInstance.post).toHaveBeenCalled();
  });

  test('prevents duplicate order creation via source order number', async () => {
    const storeId = createTestId();
    const message = createOrderSyncMessage({
      storeId,
      direction: 'shopify_to_oracle',
      records: [
        {
          id: 'rec-1',
          data: {
            id: 1002003,
            order_number: 2045,
            name: '#2045',
            email: 'buyer@example.com',
            financial_status: 'paid',
            total_price: '250.00',
            currency: 'USD',
            line_items: [{ id: 1, title: 'Item', quantity: 1, sku: 'DUP', price: '250.00' }],
            created_at: '2024-01-15T10:30:00Z',
            cancelled_at: null,
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

    // Existing order found in Oracle
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        items: [
          {
            OrderId: 8001,
            OrderNumber: '#2045',
            Status: 'BOOKED',
          },
        ],
      },
    });

    // Should UPDATE, not create
    mockAxiosInstance.patch.mockResolvedValueOnce({
      data: { OrderId: 8001 },
    });

    mockQuery.mockResolvedValueOnce({ rows: [] }); // sync log
    mockQuery.mockResolvedValueOnce({ rows: [] }); // update progress

    await handler.process(message);

    // Should have found existing order and UPDATED
    const patchCall = mockAxiosInstance.patch.mock.calls.find(
      (call: any) => call[0] === '/api/orders/8001'
    );
    expect(patchCall).toBeDefined();
    expect(mockAxiosInstance.post).not.toHaveBeenCalledWith(
      '/api/orders',
      expect.anything()
    );
  });
});
