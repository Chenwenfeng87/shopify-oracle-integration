import { Channel, ConsumeMessage } from 'amqplib';
import Redis from 'ioredis';
import { SyncQueueMessage } from '../types';
import { OrderHandler } from '../handlers/order.handler';
import { createConsumer } from './consumer.helper';
import { logger } from '../logger';

const orderHandler = new OrderHandler();

/**
 * Creates a RabbitMQ consumer for the sync.orders.queue.
 * Processes order synchronization between Shopify and Oracle.
 */
export function createOrderSyncConsumer(
  channel: Channel,
  redis: Redis
): (msg: ConsumeMessage | null) => Promise<void> {
  return createConsumer(channel, redis, 'order', async (message: SyncQueueMessage) => {
    logger.info('Order sync consumer processing batch', {
      jobId: message.jobId,
      recordsCount: message.records.length,
      direction: message.direction,
    });

    await orderHandler.process(message);

    logger.info('Order sync batch completed', {
      jobId: message.jobId,
      recordsCount: message.records.length,
    });
  });
}
