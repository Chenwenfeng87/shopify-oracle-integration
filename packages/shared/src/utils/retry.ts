/**
 * Retry utility providing exponential backoff with jitter.
 *
 * Used throughout the integration when calling external APIs (Shopify, Oracle)
 * that may experience transient failures or rate-limiting.
 */

/**
 * Configuration options for the retry mechanism.
 */
export interface RetryOptions {
  /** Maximum number of attempts before giving up (default: 3). */
  maxAttempts: number;
  /** Base delay in milliseconds for the first retry (default: 1000). */
  baseDelayMs: number;
  /** Maximum delay in milliseconds between retries (default: 30000). */
  maxDelayMs: number;
  /** Multiplier applied to the delay after each attempt (default: 2). */
  backoffMultiplier: number;
  /** Optional list of error codes that should trigger a retry. When empty, all errors are retried. */
  retryableErrors?: string[];
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
};

/**
 * Determine if an error is retryable based on its message or the provided codes list.
 *
 * When `codes` is provided, the error is retryable if its `message` or `name` includes
 * one of the given codes (case-insensitive). When `codes` is empty or omitted, every
 * error is considered retryable.
 */
export function isRetryableError(error: Error, codes?: string[]): boolean {
  if (!codes || codes.length === 0) {
    return true;
  }

  const searchTarget = `${error.name} ${error.message}`.toLowerCase();

  return codes.some((code) => searchTarget.includes(code.toLowerCase()));
}

/**
 * Calculate the delay in milliseconds before the given retry attempt using
 * exponential backoff with full jitter.
 *
 * Formula: `min(baseDelay * multiplier^(attempt-1), maxDelay)`
 * Jitter: random value between 0 and the calculated delay
 *
 * @param attempt - The current attempt number (1-based).
 * @param options - Retry configuration.
 * @returns Delay in milliseconds.
 */
export function calculateBackoff(attempt: number, options: RetryOptions): number {
  const delay = Math.min(
    options.baseDelayMs * Math.pow(options.backoffMultiplier, attempt - 1),
    options.maxDelayMs,
  );

  // Full jitter: random value between 0 and the calculated delay.
  return Math.round(Math.random() * delay);
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with automatic retries using exponential backoff with jitter.
 *
 * @example
 * const data = await withRetry(
 *   () => shopifyClient.get('/products/123'),
 *   { maxAttempts: 5, retryableErrors: ['RATE_LIMIT', 'TIMEOUT'] },
 * );
 *
 * @param fn - The async function to execute and potentially retry.
 * @param options - Partial retry options (merged with defaults).
 * @returns The resolved value of `fn`.
 * @throws The last error encountered if all attempts are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const mergedOptions: RetryOptions = { ...DEFAULT_OPTIONS, ...options };

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= mergedOptions.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Do not retry if this is the last attempt.
      if (attempt >= mergedOptions.maxAttempts) {
        break;
      }

      // Do not retry if the error is not in the retryable list.
      if (
        mergedOptions.retryableErrors &&
        mergedOptions.retryableErrors.length > 0 &&
        !isRetryableError(lastError, mergedOptions.retryableErrors)
      ) {
        break;
      }

      const delay = calculateBackoff(attempt, mergedOptions);
      await sleep(delay);
    }
  }

  // All attempts exhausted — throw the last captured error.
  throw lastError ?? new Error('withRetry: unexpected failure (no error captured)');
}
