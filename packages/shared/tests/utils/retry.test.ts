import {
  withRetry,
  isRetryableError,
  calculateBackoff,
} from '@shared/utils/retry';

describe('withRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('succeeds on first attempt', async () => {
    const fn = jest.fn().mockResolvedValue('success');

    const result = await withRetry(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on failure and succeeds on second attempt', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('First failure'))
      .mockResolvedValueOnce('success');

    const resultPromise = withRetry(fn, { baseDelayMs: 10 });

    // First attempt fails immediately, then the retry delay fires
    await jest.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('fails after max attempts (default 3)', async () => {
    const error = new Error('Persistent failure');
    const fn = jest.fn().mockRejectedValue(error);

    const resultPromise = withRetry(fn, { baseDelayMs: 10 });

    // Advance through 3 attempts: attempt 1 fails, delay, attempt 2 fails, delay, attempt 3 fails
    await jest.advanceTimersByTimeAsync(60_000);

    await expect(resultPromise).rejects.toThrow('Persistent failure');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('respects custom maxAttempts', async () => {
    const error = new Error('Custom max failure');
    const fn = jest.fn().mockRejectedValue(error);

    const resultPromise = withRetry(fn, { maxAttempts: 5, baseDelayMs: 10 });

    await jest.advanceTimersByTimeAsync(60_000);

    await expect(resultPromise).rejects.toThrow('Custom max failure');
    expect(fn).toHaveBeenCalledTimes(5);
  });

  test('uses exponential backoff (mock timers)', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'))
      .mockResolvedValueOnce('success');

    const resultPromise = withRetry(fn, { baseDelayMs: 100, maxDelayMs: 5000 });

    // After first failure, backoff = random(0..100). Advance 100ms.
    await jest.advanceTimersByTimeAsync(100);
    // After second failure, backoff = random(0..200). Advance 200ms.
    await jest.advanceTimersByTimeAsync(200);

    const result = await resultPromise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('does not retry non-retryable errors', async () => {
    const nonRetryable = new Error('VALIDATION_ERROR');
    const fn = jest.fn().mockRejectedValue(nonRetryable);

    const resultPromise = withRetry(fn, {
      retryableErrors: ['RATE_LIMIT', 'TIMEOUT'],
      baseDelayMs: 10,
    });

    await jest.advanceTimersByTimeAsync(100);

    await expect(resultPromise).rejects.toThrow('VALIDATION_ERROR');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('last error is thrown after max attempts', async () => {
    const errors = [
      new Error('Attempt 1 error'),
      new Error('Attempt 2 error'),
      new Error('Last error'),
    ];
    let callCount = 0;
    const fn = jest.fn().mockImplementation(() => {
      const err = errors[callCount];
      callCount++;
      return Promise.reject(err);
    });

    const resultPromise = withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 10,
      retryableErrors: ['error'],
    });

    await jest.advanceTimersByTimeAsync(60_000);

    await expect(resultPromise).rejects.toThrow('Last error');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('throws error when all retries exhausted', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('Exhausted'));

    const resultPromise = withRetry(fn, { maxAttempts: 1 });

    await jest.advanceTimersByTimeAsync(100);

    await expect(resultPromise).rejects.toThrow('Exhausted');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('isRetryableError', () => {
  test('returns true for matching error codes', () => {
    const error = new Error('API_RATE_LIMIT exceeded');
    expect(isRetryableError(error, ['API_RATE_LIMIT', 'TIMEOUT'])).toBe(true);
  });

  test('returns false when no codes match', () => {
    const error = new Error('VALIDATION_ERROR');
    expect(isRetryableError(error, ['API_RATE_LIMIT', 'TIMEOUT'])).toBe(false);
  });

  test('returns true when codes array is empty', () => {
    const error = new Error('Any error');
    expect(isRetryableError(error, [])).toBe(true);
  });

  test('returns true when codes is undefined', () => {
    const error = new Error('Any error');
    expect(isRetryableError(error)).toBe(true);
  });

  test('is case-insensitive when matching', () => {
    const error = new Error('rate_limit exceeded');
    expect(isRetryableError(error, ['RATE_LIMIT'])).toBe(true);
    expect(isRetryableError(error, ['Rate_Limit'])).toBe(true);
  });

  test('matches against error name as well', () => {
    const error = new Error('something went wrong');
    error.name = 'TimeoutError';
    expect(isRetryableError(error, ['TimeoutError'])).toBe(true);
  });
});

describe('calculateBackoff', () => {
  test('returns correct delays with jitter (test range)', () => {
    const options = {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
    };

    // Mock Math.random to control jitter
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const delay = calculateBackoff(1, options);
    // baseDelay * multiplier^(1-1) = 1000 * 2^0 = 1000; with jitter 0.5 => 500
    expect(delay).toBe(500);

    const delay2 = calculateBackoff(2, options);
    // baseDelay * multiplier^(2-1) = 1000 * 2^1 = 2000; with jitter 0.5 => 1000
    expect(delay2).toBe(1000);

    spy.mockRestore();
  });

  test('caps at maxDelayMs', () => {
    const spy = jest.spyOn(Math, 'random').mockReturnValue(1.0);

    const options = {
      maxAttempts: 10,
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
    };

    // Attempt 4: 1000 * 2^3 = 8000, capped at 5000, jitter 1.0 => 5000
    const delay = calculateBackoff(4, options);
    expect(delay).toBeLessThanOrEqual(5000);

    spy.mockRestore();
  });

  test('returns 0 when Math.random returns 0', () => {
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0);

    const options = {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
    };

    const delay = calculateBackoff(1, options);
    expect(delay).toBe(0);

    spy.mockRestore();
  });

  test('produces varying delays across calls (jitter range)', () => {
    const options = {
      maxAttempts: 3,
      baseDelayMs: 10000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
    };

    const delays = new Set<number>();
    // Call multiple times with varying random values
    for (let i = 0; i < 10; i++) {
      const delay = calculateBackoff(1, options);
      // Delay should be between 0 and 10000
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(10000);
      delays.add(delay);
    }

    // Most likely more than one unique delay due to jitter
    expect(delays.size).toBeGreaterThan(1);
  });
});
