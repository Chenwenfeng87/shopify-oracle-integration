import crypto from 'crypto';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { logger } from '../../utils/logger';
import { ErrorCodes } from '@shared/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShopifyRateLimitInfo {
  current: number;
  max: number;
  remaining: number;
  /** Ratio of used capacity (0-1). Useful for throttling decisions. */
  utilization: number;
}

export interface ShopifyClientOptions {
  /** Request timeout in milliseconds (default: 30000). */
  timeout?: number;
  /** API version string (default: "2024-07"). */
  apiVersion?: string;
  /** Maximum retries per request (default: 3). */
  maxRetries?: number;
  /** Whether to enable auto-throttling based on rate-limit utilization (default: true). */
  autoThrottle?: boolean;
  /** Utilization ratio (0-1) above which the client starts spacing requests (default: 0.5). */
  throttleThreshold?: number;
  /** Minimum delay in ms between requests when throttling is active (default: 500). */
  throttleDelayMs?: number;
}

export interface ShopifyApiError {
  status: number;
  code: string;
  message: string;
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ShopifyClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly raw: unknown;

  constructor(status: number, code: string, message: string, raw?: unknown) {
    super(message);
    this.name = 'ShopifyClientError';
    this.status = status;
    this.code = code;
    this.raw = raw;
  }
}

// ---------------------------------------------------------------------------
// Rate-limit state (per-instance)
// ---------------------------------------------------------------------------

interface RateLimitState {
  /** Last known API-call-limit header value. */
  lastKnown: ShopifyRateLimitInfo | null;
  /** Timestamp (ms) of the last request made. */
  lastRequestTime: number;
  /** If true we are in a throttled state. */
  throttled: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the `X-Shopify-Shop-Api-Call-Limit` header value. */
function parseRateLimitHeader(headerValue: string | undefined): ShopifyRateLimitInfo | null {
  if (!headerValue) return null;
  const parts = headerValue.split('/');
  if (parts.length !== 2) return null;
  const current = parseInt(parts[0], 10);
  const max = parseInt(parts[1], 10);
  if (isNaN(current) || isNaN(max) || max === 0) return null;
  return {
    current,
    max,
    remaining: max - current,
    utilization: current / max,
  };
}

/** Safely extract the `Retry-After` header value (seconds). */
function parseRetryAfter(response: AxiosResponse): number {
  const raw = response.headers['retry-after'];
  if (!raw) return 1;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) || parsed < 1 ? 1 : parsed;
}

/** Classify a failed HTTP response. */
function classifyError(status: number): { code: string; message: string } {
  switch (status) {
    case 401:
      return { code: ErrorCodes.AUTH_FAILED, message: 'Shopify API authentication failed' };
    case 403:
      return { code: ErrorCodes.AUTH_FAILED, message: 'Shopify API access forbidden' };
    case 404:
      return { code: ErrorCodes.RECORD_NOT_FOUND, message: 'Shopify resource not found' };
    case 429:
      return { code: ErrorCodes.API_RATE_LIMIT, message: 'Shopify API rate limit exceeded' };
    default:
      if (status >= 500) {
        return { code: ErrorCodes.API_UNAVAILABLE, message: `Shopify server error (${status})` };
      }
      return { code: 'SHOPIFY_API_ERROR', message: `Shopify API error (${status})` };
  }
}

/** Sleep for a given number of milliseconds. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// GraphQL helper
// ---------------------------------------------------------------------------

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ShopifyClient {
  private readonly http: AxiosInstance;
  private readonly options: Required<ShopifyClientOptions>;
  private readonly rateLimitState: RateLimitState = {
    lastKnown: null,
    lastRequestTime: 0,
    throttled: false,
  };

  constructor(
    public readonly storeDomain: string,
    public readonly accessToken: string,
    options: ShopifyClientOptions = {},
  ) {
    this.options = {
      timeout: options.timeout ?? 30_000,
      apiVersion: options.apiVersion ?? '2024-07',
      maxRetries: options.maxRetries ?? 3,
      autoThrottle: options.autoThrottle ?? true,
      throttleThreshold: options.throttleThreshold ?? 0.5,
      throttleDelayMs: options.throttleDelayMs ?? 500,
    };

    const baseURL = `https://${storeDomain}/admin/api/${this.options.apiVersion}`;

    this.http = axios.create({
      baseURL,
      timeout: this.options.timeout,
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    // Response interceptor – parse rate-limit headers on every response
    this.http.interceptors.response.use(
      (response: AxiosResponse) => {
        this.updateRateLimitState(response);
        return response;
      },
      (error: AxiosError) => {
        if (error.response) {
          this.updateRateLimitState(error.response);
        }
        return Promise.reject(error);
      },
    );
  }

  // -------------------------------------------------------------------------
  // Public helpers
  // -------------------------------------------------------------------------

  /** Return the last known rate-limit info (or null). */
  get rateLimitInfo(): ShopifyRateLimitInfo | null {
    return this.rateLimitState.lastKnown;
  }

  /** Return true if the client is currently throttling itself. */
  get isThrottled(): boolean {
    return this.rateLimitState.throttled;
  }

  // -------------------------------------------------------------------------
  // Core HTTP methods
  // -------------------------------------------------------------------------

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>('GET', path, { params });
  }

  async post<T>(path: string, data: unknown): Promise<T> {
    return this.request<T>('POST', path, { data });
  }

  async put<T>(path: string, data: unknown): Promise<T> {
    return this.request<T>('PUT', path, { data });
  }

  async delete(path: string): Promise<void> {
    await this.request<void>('DELETE', path);
  }

  // -------------------------------------------------------------------------
  // GraphQL
  // -------------------------------------------------------------------------

  async graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const payload: { query: string; variables?: Record<string, unknown> } = { query };
    if (variables && Object.keys(variables).length > 0) {
      payload.variables = variables;
    }

    const response = await this.request<GraphqlResponse<T>>('POST', '/graphql.json', {
      data: payload,
    });

    if (response.errors && response.errors.length > 0) {
      const first = response.errors[0];
      throw new ShopifyClientError(400, 'GRAPHQL_ERROR', first.message, response.errors);
    }

    return response.data as T;
  }

  // -------------------------------------------------------------------------
  // Request verification signature
  // -------------------------------------------------------------------------

  /**
   * Verify an incoming Shopify HMAC signature (used in proxy / webhooks).
   * @returns true if the signature is valid.
   */
  verifyHmac(queryParams: Record<string, string>, secret?: string): boolean {
    const hmacSecret = secret || this.accessToken;
    const { hmac, ...rest } = queryParams;

    if (!hmac) return false;

    const message = Object.keys(rest)
      .sort()
      .map((key) => `${key}=${rest[key]}`)
      .join('&');

    const expected = crypto
      .createHmac('sha256', hmacSecret)
      .update(message)
      .digest('hex');

    // Constant-time comparison
    if (expected.length !== hmac.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ hmac.charCodeAt(i);
    }
    return diff === 0;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Central request method that applies:
   *  - Auto-throttling
   *  - Retry with exponential backoff + jitter on 429 / 5xx
   *  - Request/response logging
   *  - Error classification
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    config?: { params?: Record<string, unknown>; data?: unknown },
  ): Promise<T> {
    await this.applyThrottle();

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        const axiosConfig: AxiosRequestConfig = {
          method,
          url: path,
          params: config?.params,
          data: config?.data,
          // Validate status so we handle non-2xx ourselves
          validateStatus: (status) => status < 400 || status === 429,
        };

        logger.debug('Shopify API request', {
          method,
          path,
          storeDomain: this.storeDomain,
          attempt,
        });

        const start = Date.now();
        const response = await this.http.request<T>(axiosConfig);
        const duration = Date.now() - start;

        this.updateRateLimitState(response);

        // Success (2xx)
        if (response.status < 400) {
          logger.debug('Shopify API success', {
            method,
            path,
            duration,
            status: response.status,
            storeDomain: this.storeDomain,
          });

          // Shopify REST responses are typically wrapped like { "product": {...} }.
          // For DELETE the body may be empty; for GET/POST/PUT we return the full
          // response data and let the calling service extract the relevant key.
          return response.data as T;
        }

        // 429 – rate limited
        if (response.status === 429) {
          const retryAfter = parseRetryAfter(response);
          const maxCap = Math.min(retryAfter * 1000, 30_000);
          const jitter = Math.round(Math.random() * 1000);
          const delay = maxCap + jitter;

          logger.warn('Shopify rate limited (429)', {
            path,
            attempt,
            retryAfterSec: retryAfter,
            delayMs: delay,
            storeDomain: this.storeDomain,
          });

          if (attempt < this.options.maxRetries) {
            await sleep(delay);
            continue;
          }

          throw new ShopifyClientError(
            429,
            ErrorCodes.API_RATE_LIMIT,
            `Rate limited after ${this.options.maxRetries} retries`,
          );
        }

        // Unhandled status (should not normally reach here due to validateStatus)
        const { code, message } = classifyError(response.status);
        throw new ShopifyClientError(response.status, code, message, response.data);
      } catch (err: unknown) {
        if (err instanceof ShopifyClientError) {
          throw err;
        }

        const axiosError = err as AxiosError;
        const isTimeout = axiosError.code === 'ECONNABORTED' || axiosError.message?.includes('timeout');
        const isNetworkError = !axiosError.response && axiosError.isAxiosError;

        if (isTimeout) {
          logger.warn('Shopify API timeout', {
            path,
            attempt,
            storeDomain: this.storeDomain,
          });

          if (attempt < this.options.maxRetries) {
            const delay = this.calculateBackoff(attempt);
            await sleep(delay);
            continue;
          }

          throw new ShopifyClientError(
            0,
            ErrorCodes.API_TIMEOUT,
            `Request timed out after ${this.options.maxRetries} retries`,
          );
        }

        if (isNetworkError) {
          logger.warn('Shopify network error', {
            path,
            attempt,
            storeDomain: this.storeDomain,
            message: axiosError.message,
          });

          if (attempt < this.options.maxRetries) {
            const delay = this.calculateBackoff(attempt);
            await sleep(delay);
            continue;
          }

          throw new ShopifyClientError(
            0,
            ErrorCodes.API_UNAVAILABLE,
            `Network error: ${axiosError.message}`,
          );
        }

        // 5xx server errors from responses we did NOT catch via validateStatus
        // (shouldn't happen, but handle anyway)
        if (axiosError.response && axiosError.response.status >= 500) {
          if (attempt < this.options.maxRetries) {
            const delay = this.calculateBackoff(attempt);
            await sleep(delay);
            continue;
          }
        }

        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt >= this.options.maxRetries) {
          break;
        }

        const delay = this.calculateBackoff(attempt);
        await sleep(delay);
      }
    }

    throw lastError ?? new Error('Shopify request failed (unknown error)');
  }

  /**
   * Called before every request. If auto-throttling is enabled and we are
   * above the utilization threshold, insert a delay.
   */
  private async applyThrottle(): Promise<void> {
    if (!this.options.autoThrottle) return;

    const info = this.rateLimitState.lastKnown;
    if (!info) return;

    const isAboveThreshold = info.utilization >= this.options.throttleThreshold;

    this.rateLimitState.throttled = isAboveThreshold;

    if (isAboveThreshold) {
      const elapsed = Date.now() - this.rateLimitState.lastRequestTime;
      const wait = Math.max(0, this.options.throttleDelayMs - elapsed);

      if (wait > 0) {
        logger.debug('Shopify auto-throttle active', {
          utilization: info.utilization.toFixed(2),
          threshold: this.options.throttleThreshold,
          delayMs: wait,
          storeDomain: this.storeDomain,
        });
        await sleep(wait);
      }
    }
  }

  /**
   * Parse and store rate-limit info from response headers.
   */
  private updateRateLimitState(response: AxiosResponse): void {
    const headerVal = response.headers['x-shopify-shop-api-call-limit'];
    const parsed = parseRateLimitHeader(headerVal);
    if (parsed) {
      this.rateLimitState.lastKnown = parsed;
    }
    this.rateLimitState.lastRequestTime = Date.now();
  }

  /**
   * Exponential backoff with full jitter.
   * Formula: min(baseDelay * 2^(attempt-1), maxDelay) * random(0, 1)
   */
  private calculateBackoff(attempt: number): number {
    const baseMs = 1_000;
    const maxMs = 60_000;
    const delay = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
    return Math.round(Math.random() * delay);
  }
}

export default ShopifyClient;
