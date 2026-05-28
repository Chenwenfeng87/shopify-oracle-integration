// ============================================================================
// CustomerSyncConsumer Tests
// ============================================================================

import {
  mockChannel,
  mockRedisInstance,
  createMockConsumeMessage,
  createCustomerSyncMessage,
  createTestId,
} from '../setup';

const mockProcess = jest.fn();
jest.mock('../../src/handlers/customer.handler', () => ({
  CustomerHandler: jest.fn().mockImplementation(() => ({
    process: mockProcess,
  })),
}));

import { createCustomerSyncConsumer } from '../../src/consumers/customer-sync.consumer';

describe('CustomerSyncConsumer', () => {
  let consumer: ReturnType<typeof createCustomerSyncConsumer>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockProcess.mockReset();
    consumer = createCustomerSyncConsumer(mockChannel as any, mockRedisInstance as any);
  });

  test('processes valid customer sync message', async () => {
    const message = createCustomerSyncMessage();
    mockProcess.mockResolvedValueOnce(undefined);
    mockRedisInstance.incr.mockResolvedValueOnce(1);

    const msg = createMockConsumeMessage(message as any);
    await consumer(msg);

    expect(mockProcess).toHaveBeenCalledTimes(1);
    expect(mockProcess).toHaveBeenCalledWith(message);
    expect(mockChannel.ack).toHaveBeenCalledWith(msg);
  });

  test('handles customer with addresses', async () => {
    const message = createCustomerSyncMessage({
      records: [
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
            addresses: [
              {
                id: 1,
                address1: '123 Main St',
                address2: 'Suite 100',
                city: 'Portland',
                province: 'Oregon',
                province_code: 'OR',
                country: 'US',
                country_code: 'US',
                zip: '97201',
                phone: '+1-555-123-4567',
                first_name: 'John',
                last_name: 'Doe',
                company: 'Acme Corp',
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
    });

    mockProcess.mockResolvedValueOnce(undefined);
    mockRedisInstance.incr.mockResolvedValueOnce(1);

    const msg = createMockConsumeMessage(message as any);
    await consumer(msg);

    expect(mockProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        records: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              addresses: expect.arrayContaining([
                expect.objectContaining({
                  address1: '123 Main St',
                  city: 'Portland',
                }),
              ]),
            }),
          }),
        ]),
      })
    );
    expect(mockChannel.ack).toHaveBeenCalled();
  });

  test('handles customer without addresses', async () => {
    const message = createCustomerSyncMessage({
      records: [
        {
          id: 'rec-1',
          data: {
            id: 555002,
            email: 'jane.doe@example.com',
            first_name: 'Jane',
            last_name: 'Doe',
            phone: null,
            verified_email: true,
            addresses: [],
            default_address: null,
          },
        },
      ],
    });

    mockProcess.mockResolvedValueOnce(undefined);
    mockRedisInstance.incr.mockResolvedValueOnce(1);

    const msg = createMockConsumeMessage(message as any);
    await consumer(msg);

    expect(mockProcess).toHaveBeenCalled();
    expect(mockChannel.ack).toHaveBeenCalled();
  });

  test('acks on success, nacks on failure', async () => {
    // Success case
    const successMessage = createCustomerSyncMessage({ retryCount: 0 });
    mockProcess.mockResolvedValueOnce(undefined);
    mockRedisInstance.incr.mockResolvedValueOnce(1);

    const successMsg = createMockConsumeMessage(successMessage as any);
    await consumer(successMsg);
    expect(mockChannel.ack).toHaveBeenCalledWith(successMsg);

    // Failure case
    const failMessage = createCustomerSyncMessage({ retryCount: 0 });
    mockProcess.mockRejectedValueOnce(new Error('Oracle API unavailable'));

    const failMsg = createMockConsumeMessage(failMessage as any);
    await consumer(failMsg);
    expect(mockChannel.nack).toHaveBeenCalledWith(failMsg, false, false);
  });

  test('DLQ routing after max retries', async () => {
    const message = createCustomerSyncMessage({ retryCount: 3 });
    mockProcess.mockRejectedValueOnce(new Error('Max retries exceeded'));

    const msg = createMockConsumeMessage(message as any, {
      headers: {
        'x-death': [
          {
            queue: 'sync.dlq',
            count: 3,
          },
        ],
      },
    });
    await consumer(msg);

    expect(mockChannel.publish).toHaveBeenCalledWith(
      'sync.dlx',
      'dlq',
      msg.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-error': 'Max retries exceeded',
          'x-original-routing-key': expect.any(String),
        }),
      })
    );
    expect(mockChannel.ack).toHaveBeenCalledWith(msg);
  });

  test('handles malformed JSON in customer message', async () => {
    const msg = createMockConsumeMessage({} as any);
    Object.defineProperty(msg, 'content', {
      value: Buffer.from('{{{bad json'),
    });

    await consumer(msg);

    expect(mockChannel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(mockProcess).not.toHaveBeenCalled();
  });

  test('handles null message', async () => {
    await consumer(null);
    expect(mockProcess).not.toHaveBeenCalled();
  });
});
