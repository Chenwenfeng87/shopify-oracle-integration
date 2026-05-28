import { Channel, ConsumeMessage } from 'amqplib';
import Redis from 'ioredis';
import { SyncQueueMessage } from '../types';
import { PriceHandler } from '../handlers/price.handler';
import { createConsumer } from './consumer.helper';
import { logger } from '../logger';

const priceHandler = new PriceHandler();

/**
 * Creates a RabbitMQ consumer for the sync.prices.queue.
 * Processes price synchronization between Shopify and Oracle.
 */
export function createPriceSyncConsumer(
  channel: Channel,
  redis: Redis
): (msg: ConsumeMessage | null) => Promise<void> {
  return createConsumer(channel, redis, 'price', async (message: SyncQueueMessage) => {
    logger.info('Price sync consumer processing batch', {
      jobId: message.jobId,
      recordsCount: message.records.length,
      direction: message.direction,
    });

    await priceHandler.process(message);

    logger.info('Price sync batch completed', {
      jobId: message.jobId,
      recordsCount: message.records.length,
    });
  });
}
