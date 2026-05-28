import { Channel, ConsumeMessage } from 'amqplib';
import Redis from 'ioredis';
import { SyncQueueMessage } from '../types';
import { ItemHandler } from '../handlers/item.handler';
import { createConsumer } from './consumer.helper';
import { logger } from '../logger';

const itemHandler = new ItemHandler();

/**
 * Creates a RabbitMQ consumer for the sync.items.queue.
 * Processes item/product synchronization between Oracle and Shopify.
 */
export function createItemSyncConsumer(
  channel: Channel,
  redis: Redis
): (msg: ConsumeMessage | null) => Promise<void> {
  return createConsumer(channel, redis, 'item', async (message: SyncQueueMessage) => {
    logger.info('Item sync consumer processing batch', {
      jobId: message.jobId,
      recordsCount: message.records.length,
      direction: message.direction,
    });

    await itemHandler.process(message);

    logger.info('Item sync batch completed', {
      jobId: message.jobId,
      recordsCount: message.records.length,
    });
  });
}
