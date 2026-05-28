import amqplib, { Connection, Channel, ConsumeMessage } from 'amqplib';
import { config } from './app.config';
import { logger } from '../utils/logger';

let connection: Connection | null = null;
let channel: Channel | null = null;
let isConnecting = false;
let connectionAttempts = 0;
const MAX_RETRIES = 10;
const INITIAL_RETRY_DELAY = 1000;

/**
 * Calculate delay for connection retry using exponential backoff.
 */
function getRetryDelay(attempt: number): number {
  return Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), 30000);
}

/**
 * Create a RabbitMQ connection with retry logic.
 * Uses exponential backoff up to a maximum of MAX_RETRIES attempts.
 */
export async function createConnection(): Promise<Connection> {
  if (connection) {
    return connection;
  }

  if (isConnecting) {
    throw new Error('RabbitMQ connection already in progress');
  }

  isConnecting = true;
  connectionAttempts = 0;

  while (connectionAttempts < MAX_RETRIES) {
    try {
      connectionAttempts++;
      logger.info(
        `Connecting to RabbitMQ (attempt ${connectionAttempts}/${MAX_RETRIES})...`,
      );

      connection = await amqplib.connect(config.rabbitmq.url, {
        heartbeat: 30,
        timeout: 10000,
      });

      connection.on('error', (err: Error) => {
        logger.error('RabbitMQ connection error', {
          error: err.message,
        });
        connection = null;
      });

      connection.on('close', () => {
        logger.warn('RabbitMQ connection closed');
        connection = null;
        channel = null;
      });

      connection.on('blocked', (reason: string) => {
        logger.warn('RabbitMQ connection blocked', { reason });
      });

      connection.on('unblocked', () => {
        logger.info('RabbitMQ connection unblocked');
      });

      isConnecting = false;
      logger.info('RabbitMQ connection established successfully');
      return connection;
    } catch (error) {
      const delay = getRetryDelay(connectionAttempts);
      logger.error(
        `RabbitMQ connection attempt ${connectionAttempts} failed, retrying in ${delay}ms`,
        { error: (error as Error).message },
      );

      if (connectionAttempts < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  isConnecting = false;
  throw new Error(
    `Failed to connect to RabbitMQ after ${MAX_RETRIES} attempts`,
  );
}

/**
 * Get or create a RabbitMQ channel.
 * If no connection exists, creates one first.
 */
export async function getChannel(): Promise<Channel> {
  if (channel && channel.isOpen()) {
    return channel;
  }

  const conn = await createConnection();

  try {
    channel = await conn.createChannel();

    channel.on('error', (err: Error) => {
      logger.error('RabbitMQ channel error', {
        error: err.message,
      });
      channel = null;
    });

    channel.on('close', () => {
      logger.warn('RabbitMQ channel closed');
      channel = null;
    });

    // Set prefetch to control concurrent message processing
    await channel.prefetch(10);

    logger.info('RabbitMQ channel created successfully');
    return channel;
  } catch (error) {
    logger.error('Failed to create RabbitMQ channel', {
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Assert that a queue exists and return its name.
 * Creates the queue if it doesn't exist.
 */
export async function assertQueue(
  queueName: string,
  options?: amqplib.Options.AssertQueue,
): Promise<amqplib.Replies.AssertQueue> {
  const ch = await getChannel();
  return ch.assertQueue(queueName, {
    durable: true,
    ...options,
  });
}

/**
 * Assert that an exchange exists and return its name.
 * Creates the exchange if it doesn't exist.
 */
export async function assertExchange(
  exchangeName: string,
  type: string,
  options?: amqplib.Options.AssertExchange,
): Promise<amqplib.Replies.AssertExchange> {
  const ch = await getChannel();
  return ch.assertExchange(exchangeName, type, {
    durable: true,
    ...options,
  });
}

/**
 * Bind a queue to an exchange with a routing key.
 */
export async function bindQueue(
  queue: string,
  exchange: string,
  routingKey: string,
): Promise<void> {
  const ch = await getChannel();
  await ch.bindQueue(queue, exchange, routingKey);
}

/**
 * Publish a message to an exchange with a routing key.
 */
export async function publishMessage(
  exchange: string,
  routingKey: string,
  content: unknown,
  options?: amqplib.Options.Publish,
): Promise<boolean> {
  const ch = await getChannel();
  const buffer = Buffer.from(JSON.stringify(content));
  return ch.publish(exchange, routingKey, buffer, {
    persistent: true,
    contentType: 'application/json',
    ...options,
  });
}

/**
 * Send a message directly to a queue.
 */
export async function sendToQueue(
  queue: string,
  content: unknown,
  options?: amqplib.Options.Publish,
): Promise<boolean> {
  const ch = await getChannel();
  const buffer = Buffer.from(JSON.stringify(content));
  return ch.sendToQueue(queue, buffer, {
    persistent: true,
    contentType: 'application/json',
    ...options,
  });
}

/**
 * Consume messages from a queue with automatic ack/nack handling.
 */
export async function consumeQueue(
  queue: string,
  handler: (message: ConsumeMessage) => Promise<void>,
  options?: amqplib.Options.Consume,
): Promise<amqplib.Replies.Consume> {
  const ch = await getChannel();
  return ch.consume(
    queue,
    async (msg) => {
      if (!msg) {
        return;
      }
      try {
        await handler(msg);
        ch.ack(msg);
      } catch (error) {
        logger.error('Failed to process queue message', {
          queue,
          error: (error as Error).message,
        });
        // Reject and don't requeue after max retries
        if (msg.properties.headers?.retryCount >= 3) {
          ch.reject(msg, false);
        } else {
          ch.nack(msg, false, true);
        }
      }
    },
    { noAck: false, ...options },
  );
}

/**
 * Close the RabbitMQ channel gracefully.
 */
export async function closeChannel(): Promise<void> {
  if (channel) {
    try {
      await channel.close();
      logger.info('RabbitMQ channel closed');
    } catch (error) {
      logger.error('Error closing RabbitMQ channel', {
        error: (error as Error).message,
      });
    }
    channel = null;
  }
}

/**
 * Close the RabbitMQ connection gracefully.
 */
export async function closeConnection(): Promise<void> {
  await closeChannel();
  if (connection) {
    try {
      await connection.close();
      logger.info('RabbitMQ connection closed');
    } catch (error) {
      logger.error('Error closing RabbitMQ connection', {
        error: (error as Error).message,
      });
    }
    connection = null;
  }
}

/**
 * Test RabbitMQ connectivity by creating a temporary connection.
 */
export async function testConnection(): Promise<boolean> {
  try {
    const conn = await amqplib.connect(config.rabbitmq.url, { timeout: 5000 });
    await conn.close();
    return true;
  } catch (error) {
    logger.error('RabbitMQ connection test failed', {
      error: (error as Error).message,
    });
    return false;
  }
}

export { connection, channel };
