import { Channel, ConsumeMessage } from 'amqplib';
import Redis from 'ioredis';
import { SyncQueueMessage } from '../types';
import { logger } from '../logger';

const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);

/**
 * Extract retry count from message headers (set by DLX re-queuing).
 */
function getRetryCount(msg: ConsumeMessage): number {
  const deaths = msg.properties.headers?.['x-death'];
  if (Array.isArray(deaths)) {
    const dlxDeath = deaths.find((d: Record<string, unknown>) => d.queue === 'sync.dlq');
    if (dlxDeath && typeof dlxDeath.count === 'number') {
      return dlxDeath.count;
    }
  }
  // Fall back to the message payload retry count
  try {
    const content = msg.content.toString();
    const parsed: SyncQueueMessage = JSON.parse(content);
    return parsed.retryCount || 0;
  } catch {
    return 0;
  }
}

/**
 * Send a message to the dead letter queue after max retries.
 */
async function sendToDLQ(channel: Channel, msg: ConsumeMessage, error: Error): Promise<void> {
  try {
    const headers = {
      ...msg.properties.headers,
      'x-error': error.message.substring(0, 500),
      'x-failed-at': new Date().toISOString(),
      'x-original-routing-key': msg.fields.routingKey,
    };

    channel.publish('sync.dlx', 'dlq', msg.content, {
      persistent: true,
      headers,
    });

    logger.warn('Message sent to DLQ', {
      routingKey: msg.fields.routingKey,
      error: error.message,
    });
  } catch (dlqErr) {
    logger.error('Failed to send message to DLQ', {
      error: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
    });
  }
}

/**
 * Process a queue message with retry logic.
 * Calls the provided processor function and handles ack/nack.
 */
export function createConsumer(
  channel: Channel,
  redis: Redis,
  entityType: string,
  processor: (message: SyncQueueMessage) => Promise<void>
) {
  return async (msg: ConsumeMessage | null): Promise<void> => {
    if (!msg) {
      logger.warn('Empty consumer message received (possibly consumer cancelled)');
      return;
    }

    const retryCount = getRetryCount(msg);
    let parsedMessage: SyncQueueMessage;

    try {
      const content = msg.content.toString();
      parsedMessage = JSON.parse(content) as SyncQueueMessage;
    } catch (parseError) {
      logger.error('Failed to parse queue message', {
        routingKey: msg.fields.routingKey,
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      // Non-parseable message goes straight to DLQ
      channel.nack(msg, false, false);
      return;
    }

    const log = logger.child({
      entityType,
      jobId: parsedMessage.jobId,
      storeId: parsedMessage.storeId,
      retryCount,
      messageId: msg.properties.messageId,
    });

    log.info('Processing sync message', {
      recordsCount: parsedMessage.records?.length || 0,
      direction: parsedMessage.direction,
      trigger: parsedMessage.trigger,
    });

    try {
      await processor(parsedMessage);

      // Success — acknowledge the message
      channel.ack(msg);
      log.info('Sync message processed successfully', {
        recordsCount: parsedMessage.records?.length || 0,
      });

      // Track processed count in Redis for observability
      try {
        const today = new Date().toISOString().slice(0, 10);
        await redis.incr(`stats:${entityType}:processed:${today}`);
      } catch {
        // Redis tracking failure is non-critical
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error('Failed to process sync message', { error: errMsg });

      if (retryCount < MAX_RETRIES) {
        // Reject and requeue for retry via DLX
        log.warn('Rejecting message for retry', {
          retryCount,
          maxRetries: MAX_RETRIES,
          nextRetry: retryCount + 1,
        });
        channel.nack(msg, false, false);

        // Record retry in Redis
        try {
          const today = new Date().toISOString().slice(0, 10);
          await redis.incr(`stats:${entityType}:retries:${today}`);
        } catch {
          // Non-critical
        }
      } else {
        // Max retries exceeded — send to DLQ
        log.error('Max retries exceeded, sending to DLQ', {
          retryCount,
          maxRetries: MAX_RETRIES,
        });
        await sendToDLQ(channel, msg, error instanceof Error ? error : new Error(errMsg));
        channel.ack(msg); // Remove from main queue since it's in DLQ

        // Track failure in Redis
        try {
          const today = new Date().toISOString().slice(0, 10);
          await redis.incr(`stats:${entityType}:failed:${today}`);
        } catch {
          // Non-critical
        }
      }
    }
  };
}
