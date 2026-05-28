import { Channel, ConsumeMessage } from 'amqplib';
import Redis from 'ioredis';
import { SyncQueueMessage } from '../types';
import { CustomerHandler } from '../handlers/customer.handler';
import { createConsumer } from './consumer.helper';
import { logger } from '../logger';

const customerHandler = new CustomerHandler();

/**
 * Creates a RabbitMQ consumer for the sync.customers.queue.
 * Processes customer synchronization between Shopify and Oracle.
 */
export function createCustomerSyncConsumer(
  channel: Channel,
  redis: Redis
): (msg: ConsumeMessage | null) => Promise<void> {
  return createConsumer(channel, redis, 'customer', async (message: SyncQueueMessage) => {
    logger.info('Customer sync consumer processing batch', {
      jobId: message.jobId,
      recordsCount: message.records.length,
      direction: message.direction,
    });

    await customerHandler.process(message);

    logger.info('Customer sync batch completed', {
      jobId: message.jobId,
      recordsCount: message.records.length,
    });
  });
}
