import { Channel, ConsumeMessage } from 'amqplib';
import Redis from 'ioredis';
import { SyncQueueMessage } from '../types';
import { InventoryHandler } from '../handlers/inventory.handler';
import { createConsumer } from './consumer.helper';
import { logger } from '../logger';

const inventoryHandler = new InventoryHandler();

/**
 * Creates a RabbitMQ consumer for the sync.inventory.queue.
 * Processes inventory level synchronization between Oracle and Shopify.
 */
export function createInventorySyncConsumer(
  channel: Channel,
  redis: Redis
): (msg: ConsumeMessage | null) => Promise<void> {
  return createConsumer(channel, redis, 'inventory', async (message: SyncQueueMessage) => {
    logger.info('Inventory sync consumer processing batch', {
      jobId: message.jobId,
      recordsCount: message.records.length,
      direction: message.direction,
    });

    await inventoryHandler.process(message);

    logger.info('Inventory sync batch completed', {
      jobId: message.jobId,
      recordsCount: message.records.length,
    });
  });
}
