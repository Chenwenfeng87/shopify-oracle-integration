import amqplib from 'amqplib';
import { v4 as uuidv4 } from 'uuid';
import { getChannel, assertExchange, assertQueue, bindQueue, publishMessage, sendToQueue } from '../../config/rabbitmq';
import { logger } from '../../utils/logger';
import type { SyncQueueMessage } from '@shared/types';

/**
 * Exchange name for all sync-related messages.
 * Topic exchange type allows flexible routing by entity type.
 */
const SYNC_EXCHANGE = 'sync.exchange';

/**
 * Routing key patterns for each entity type.
 * Used to route messages from the exchange to entity-specific queues.
 */
const ROUTING_KEYS: Record<string, string> = {
  item: 'sync.item.*',
  customer: 'sync.customer.*',
  order: 'sync.order.*',
  price: 'sync.price.*',
  inventory: 'sync.inventory.*',
};

/**
 * Entity queue names for each sync entity type.
 * Each queue is bound to the topic exchange with its entity's routing key.
 */
const ENTITY_QUEUES: Record<string, string> = {
  item: 'sync.items.queue',
  customer: 'sync.customers.queue',
  order: 'sync.orders.queue',
  price: 'sync.prices.queue',
  inventory: 'sync.inventory.queue',
};

/**
 * Queue name for retry messages with delayed re-delivery.
 * Configured with a Dead Letter Exchange (DLX) pointing back to the main
 * exchange so that after the TTL expires the message is re-routed.
 */
const RETRY_QUEUE = 'sync.retry.queue';

/**
 * Dead Letter Queue for messages that have exhausted all retry attempts.
 * These messages require manual inspection by an administrator.
 */
const DLQ = 'sync.dlq';

/**
 * Maximum number of times a single message will be retried.
 * After this limit, the message is sent to the DLQ.
 */
const MAX_RETRIES_PER_MESSAGE = 3;

/**
 * Base delay in milliseconds for retry queue messages.
 * Each retry attempt increases the delay: TTL = baseDelay * (retryCount + 1).
 */
const BASE_RETRY_DELAY_MS = 30_000; // 30 seconds

/**
 * Service responsible for all RabbitMQ queue operations.
 *
 * Manages the lifecycle of a topic exchange, entity-specific queues,
 * a retry queue with delayed re-delivery via DLX, and a dead letter queue
 * for permanently failed messages.
 */
export class QueueService {
  private initialized = false;

  /**
   * Initialize RabbitMQ topology:
   *  1. Assert the topic exchange.
   *  2. Assert each entity queue and bind it with entity-specific routing keys.
   *  3. Assert the retry queue configured with DLX back to the main exchange.
   *  4. Assert the dead letter queue.
   *
   * Safe to call multiple times — subsequent calls are no-ops once initialized.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // 1. Assert the topic exchange
      await assertExchange(SYNC_EXCHANGE, 'topic', { durable: true });
      logger.info('Sync exchange asserted', { exchange: SYNC_EXCHANGE });

      // 2. Assert and bind entity queues
      const entities = ['item', 'customer', 'order', 'price', 'inventory'];
      for (const entity of entities) {
        const queueName = ENTITY_QUEUES[entity];
        const routingKey = ROUTING_KEYS[entity];

        await assertQueue(queueName, {
          durable: true,
        });

        await bindQueue(queueName, SYNC_EXCHANGE, routingKey);

        logger.info('Entity queue bound', {
          queue: queueName,
          exchange: SYNC_EXCHANGE,
          routingKey,
        });
      }

      // 3. Assert retry queue with DLX pointing back to the main exchange.
      //    Messages in this queue expire after a TTL and are re-routed through
      //    the main exchange for re-delivery to the appropriate entity queue.
      await assertQueue(RETRY_QUEUE, {
        durable: true,
        deadLetterExchange: SYNC_EXCHANGE,
        // The dead letter routing key is set per-message via properties;
        // the queue-level default is a catch-all.
        messageTtl: BASE_RETRY_DELAY_MS,
      });
      logger.info('Retry queue asserted', { queue: RETRY_QUEUE, dlx: SYNC_EXCHANGE });

      // 4. Assert the dead letter queue — no retry, no DLX.
      await assertQueue(DLQ, {
        durable: true,
      });
      logger.info('Dead letter queue asserted', { queue: DLQ });

      this.initialized = true;
      logger.info('Queue service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize queue service', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Publish a sync batch message to the topic exchange.
   * The message is routed to the correct entity queue based on the
   * entity type in the message.
   *
   * @param message - The sync queue message to publish.
   */
  async publishSyncJob(message: SyncQueueMessage): Promise<void> {
    await this.ensureInitialized();

    const routingKey = `sync.${message.entityType}.batch`;
    const messageId = uuidv4();

    const published = await publishMessage(SYNC_EXCHANGE, routingKey, message, {
      persistent: true,
      messageId,
      contentType: 'application/json',
      headers: {
        retryCount: message.retryCount ?? 0,
        maxRetries: message.maxRetries ?? MAX_RETRIES_PER_MESSAGE,
        entityType: message.entityType,
        jobId: message.jobId,
      },
    });

    if (published) {
      logger.debug('Sync job message published', {
        jobId: message.jobId,
        entityType: message.entityType,
        batchIndex: message.batchIndex,
        totalBatches: message.totalBatches,
        routingKey,
        messageId,
      });
    } else {
      logger.error('Failed to publish sync job message', {
        jobId: message.jobId,
        entityType: message.entityType,
        batchIndex: message.batchIndex,
        routingKey,
        messageId,
      });
      throw new Error(`Failed to publish message for job ${message.jobId} batch ${message.batchIndex}`);
    }
  }

  /**
   * Send a message to the retry queue for delayed re-processing.
   * The TTL is calculated based on the current retry count so that
   * subsequent retries wait progressively longer.
   *
   * @param message - The sync queue message to retry.
   * @param delayMs - Delay in milliseconds before the message is re-delivered.
   */
  async publishRetry(message: SyncQueueMessage, delayMs: number): Promise<void> {
    await this.ensureInitialized();

    const messageId = uuidv4();
    const routingKey = `sync.${message.entityType}.batch`;
    const ttl = delayMs > 0 ? delayMs : BASE_RETRY_DELAY_MS * (message.retryCount + 1);

    const incrementedRetryCount = (message.retryCount ?? 0) + 1;

    // Send to the retry queue with a per-message TTL.
    // When the TTL expires, RabbitMQ dead-letters the message to the
    // sync.exchange, which then routes it to the correct entity queue
    // based on the routing key we set in the DLX properties.
    const published = await sendToQueue(RETRY_QUEUE, message, {
      persistent: true,
      messageId,
      expiration: ttl,
      headers: {
        retryCount: incrementedRetryCount,
        maxRetries: message.maxRetries ?? MAX_RETRIES_PER_MESSAGE,
        entityType: message.entityType,
        jobId: message.jobId,
        'x-death': [{ 'reason': 'expired', 'count': incrementedRetryCount }],
      },
      // The dead letter routing key determines which entity queue receives
      // the message after the TTL expires.
      CC: routingKey,
    });

    if (published) {
      logger.info('Sync job message sent to retry queue', {
        jobId: message.jobId,
        entityType: message.entityType,
        batchIndex: message.batchIndex,
        retryCount: incrementedRetryCount,
        ttl,
        messageId,
      });
    } else {
      logger.error('Failed to send message to retry queue', {
        jobId: message.jobId,
        entityType: message.entityType,
        batchIndex: message.batchIndex,
        messageId,
      });
      throw new Error(`Failed to send message to retry queue for job ${message.jobId}`);
    }
  }

  /**
   * Publish a message to the Dead Letter Queue.
   * Messages arrive here after exhausting all retry attempts.
   * They require manual investigation by an administrator.
   *
   * @param message - The original sync queue message that failed.
   * @param error - The error that caused the final failure.
   */
  async publishToDLQ(message: SyncQueueMessage, error: Error): Promise<void> {
    await this.ensureInitialized();

    const dlqMessage = {
      ...message,
      failedAt: new Date().toISOString(),
      errorMessage: error.message,
      errorStack: error.stack,
    };

    const messageId = uuidv4();

    const published = await sendToQueue(DLQ, dlqMessage, {
      persistent: true,
      messageId,
      headers: {
        originalJobId: message.jobId,
        entityType: message.entityType,
        batchIndex: message.batchIndex,
        finalRetryCount: message.retryCount,
        failedAt: new Date().toISOString(),
      },
    });

    if (published) {
      logger.error('Message sent to dead letter queue', {
        jobId: message.jobId,
        entityType: message.entityType,
        batchIndex: message.batchIndex,
        retryCount: message.retryCount,
        error: error.message,
        messageId,
      });
    } else {
      logger.error('Failed to send message to dead letter queue', {
        jobId: message.jobId,
        entityType: message.entityType,
        batchIndex: message.batchIndex,
        messageId,
      });
    }
  }

  /**
   * Retrieve queue statistics for all managed queues.
   * Returns the number of messages and active consumers per queue.
   */
  async getQueueStats(): Promise<Record<string, { messages: number; consumers: number }>> {
    await this.ensureInitialized();

    const channel = await getChannel();
    const queueNames = [
      ...Object.values(ENTITY_QUEUES),
      RETRY_QUEUE,
      DLQ,
    ];

    const stats: Record<string, { messages: number; consumers: number }> = {};

    for (const queueName of queueNames) {
      try {
        const queueInfo = await channel.checkQueue(queueName);
        stats[queueName] = {
          messages: queueInfo.messageCount,
          consumers: queueInfo.consumerCount,
        };
      } catch (error) {
        logger.warn('Failed to check queue stats', {
          queue: queueName,
          error: (error as Error).message,
        });
        stats[queueName] = { messages: 0, consumers: 0 };
      }
    }

    return stats;
  }

  /**
   * Close the channel gracefully.
   * Resets the initialized flag so that subsequent calls will re-initialize.
   */
  async close(): Promise<void> {
    try {
      const channel = await getChannel();
      await channel.close();
      this.initialized = false;
      logger.info('Queue service closed');
    } catch (error) {
      logger.error('Error closing queue service', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Ensure the queue topology has been initialized before performing operations.
   * Throws if initialization has not completed.
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

export default QueueService;
