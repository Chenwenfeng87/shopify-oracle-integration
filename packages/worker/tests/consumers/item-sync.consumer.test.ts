// ============================================================================
// ItemSyncConsumer Tests
// ============================================================================

import {
  mockChannel,
  mockRedisInstance,
  createMockConsumeMessage,
  createItemSyncMessage,
  createTestId,
} from '../setup';

// Mock the handler before importing the consumer
const mockProcess = jest.fn();
jest.mock('../../src/handlers/item.handler', () => ({
  ItemHandler: jest.fn().mockImplementation(() => ({
    process: mockProcess,
  })),
}));

import { createItemSyncConsumer } from '../../src/consumers/item-sync.consumer';

describe('ItemSyncConsumer', () => {
  let consumer: ReturnType<typeof createItemSyncConsumer>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockProcess.mockReset();
    consumer = createItemSyncConsumer(mockChannel as any, mockRedisInstance as any);
  });

  test('processes valid item sync message', async () => {
    const message = createItemSyncMessage();
    mockProcess.mockResolvedValueOnce(undefined);
    mockRedisInstance.incr.mockResolvedValueOnce(1);

    const msg = createMockConsumeMessage(message as any);
    await consumer(msg);

    expect(mockProcess).toHaveBeenCalledTimes(1);
    expect(mockProcess).toHaveBeenCalledWith(message);
    expect(mockChannel.ack).toHaveBeenCalledWith(msg);
  });

  test('acks message on success', async () => {
    const message = createItemSyncMessage();
    mockProcess.mockResolvedValueOnce(undefined);
    mockRedisInstance.incr.mockResolvedValueOnce(1);

    const msg = createMockConsumeMessage(message as any);
    await consumer(msg);

    expect(mockChannel.ack).toHaveBeenCalledTimes(1);
    expect(mockChannel.ack).toHaveBeenCalledWith(msg);
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });

  test('nacks message on failure for retry', async () => {
    const message = createItemSyncMessage({ retryCount: 0 });
    mockProcess.mockRejectedValueOnce(new Error('Shopify API timeout'));

    const msg = createMockConsumeMessage(message as any);
    await consumer(msg);

    expect(mockChannel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(mockChannel.ack).not.toHaveBeenCalled();
    // Should track retry in Redis
    expect(mockRedisInstance.incr).toHaveBeenCalledWith(
      expect.stringContaining('stats:item:retries:')
    );
  });

  test('sends to DLQ after max retries', async () => {
    const message = createItemSyncMessage({ retryCount: 3 });
    mockProcess.mockRejectedValueOnce(new Error('Persistent failure'));

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

    // Should publish to DLQ and ack the original
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'sync.dlx',
      'dlq',
      msg.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-error': 'Persistent failure',
        }),
      })
    );
    expect(mockChannel.ack).toHaveBeenCalledWith(msg);
    // Should track failure in Redis
    expect(mockRedisInstance.incr).toHaveBeenCalledWith(
      expect.stringContaining('stats:item:failed:')
    );
  });

  test('parses message body correctly', async () => {
    const message = createItemSyncMessage({ retryCount: 0 });
    mockProcess.mockResolvedValueOnce(undefined);
    mockRedisInstance.incr.mockResolvedValueOnce(1);

    const msg = createMockConsumeMessage(message as any);
    await consumer(msg);

    expect(mockProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: message.jobId,
        storeId: message.storeId,
        entityType: 'item',
        records: expect.arrayContaining([
          expect.objectContaining({
            id: 'rec-1',
            data: expect.objectContaining({
              ItemNumber: 'SKU-001',
            }),
          }),
        ]),
      })
    );
  });

  test('handles malformed JSON message', async () => {
    const msg = createMockConsumeMessage({} as any);
    // Replace content with invalid JSON
    Object.defineProperty(msg, 'content', {
      value: Buffer.from('not valid json {{{'),
    });

    await consumer(msg);

    expect(mockChannel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(mockProcess).not.toHaveBeenCalled();
  });

  test('handles empty records array', async () => {
    const message = createItemSyncMessage({ records: [] });
    mockProcess.mockResolvedValueOnce(undefined);
    mockRedisInstance.incr.mockResolvedValueOnce(1);

    const msg = createMockConsumeMessage(message as any);
    await consumer(msg);

    expect(mockProcess).toHaveBeenCalled();
    expect(mockChannel.ack).toHaveBeenCalled();
  });

  test('handles null message gracefully', async () => {
    await consumer(null);

    expect(mockProcess).not.toHaveBeenCalled();
    expect(mockChannel.ack).not.toHaveBeenCalled();
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });

  test('handles empty content buffer', async () => {
    const msg = createMockConsumeMessage({} as any);
    Object.defineProperty(msg, 'content', {
      value: Buffer.from(''),
    });

    await consumer(msg);

    expect(mockChannel.nack).toHaveBeenCalledWith(msg, false, false);
  });

  test('Redis tracking failure does not crash consumer', async () => {
    const message = createItemSyncMessage();
    mockProcess.mockResolvedValueOnce(undefined);
    // Redis incr fails
    mockRedisInstance.incr.mockRejectedValueOnce(new Error('Redis connection lost'));

    const msg = createMockConsumeMessage(message as any);
    await consumer(msg);

    // Should still ack even if Redis tracking fails
    expect(mockChannel.ack).toHaveBeenCalled();
  });
});
