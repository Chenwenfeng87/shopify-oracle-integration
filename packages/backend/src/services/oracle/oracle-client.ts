import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { getRedisClient } from '../../config/redis';
import { logger } from '../../utils/logger';
import { ErrorCodes } from '@shared/constants';
import type { OracleBatchRequest, OracleBatchResponse } from '@shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OracleClientOptions {
  /** Request timeout in milliseconds (default: 30000). */
  timeout?: number;
  /** Maximum retries per request (default: 3). */
  maxRetries?: number;
  /** Redis key prefix for cached tokens (default: "oracle:token:"). */
  tokenCachePrefix?: string;
  /** Token expiry buffer in seconds – refresh this many seconds before actual expiry (default: 60). */
  tokenExpiryBufferSec?: number;
}

export interface OracleApiError {
  status: number;
  code: string;
  message: string;
  /** Oracle-specific error detail often nested in the response body. */
  detail?: unknown;
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class OracleClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly detail?: unknown;
  public readonly raw: unknown;

  constructor(status: number, code: string, message: string, detail?: unknown, raw?: unknown) {
    super(message);
    this.name = 'OracleClientError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.raw = raw;
  }
}

// ---------------------------------------------------------------------------
// Token cache helpers
// ---------------------------------------------------------------------------

function tokenCacheKey(baseUrl: string): string {
  return `oracle:token:${Buffer.from(baseUrl).toString('base64')}`;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Classify an Oracle HTTP error response. */
function classifyOracleError(status: number, body: unknown): { code: string; message: string; detail?: unknown } {
  switch (status) {
    case 401:
      return { code: ErrorCodes.AUTH_FAILED, message: 'Oracle authentication failed' };
    case 403:
      return { code: ErrorCodes.AUTH_FAILED, message: 'Oracle access forbidden' };
    case 404:
      return { code: ErrorCodes.RECORD_NOT_FOUND, message: 'Oracle resource not found' };
    case 429:
      return { code: ErrorCodes.API_RATE_LIMIT, message: 'Oracle API rate limit exceeded' };
    default:
      if (status >= 500) {
        return {
          code: ErrorCodes.API_UNAVAILABLE,
          message: `Oracle server error (${status})`,
          detail: body,
        };
      }
      return {
        code: 'ORACLE_API_ERROR',
        message: `Oracle API error (${status})`,
        detail: body,
      };
  }
}

/** Extract Oracle-specific error detail from the response body. */
function extractOracleErrorDetail(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;

  const obj = body as Record<string, unknown>;

  // Oracle REST often wraps errors like:
  // { "error": { "code": "...", "message": "..." } }
  // { "errorCode": "...", "errorMessage": "..." }
  // { "type": "...", "title": "...", "detail": "..." } (RFC 7807)

  const error = obj.error as Record<string, unknown> | undefined;
  if (error) {
    return (error.message as string) || (error.detail as string) || JSON.stringify(error);
  }

  return (obj.errorMessage as string) || (obj.detail as string) || (obj.title as string) || undefined;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class OracleClient {
  private readonly http: AxiosInstance;
  private readonly options: Required<OracleClientOptions>;
  private token: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(
    public readonly baseUrl: string,
    public readonly username: string,
    public readonly password: string,
    public readonly identityDomain?: string,
    options: OracleClientOptions = {},
  ) {
    // Normalize base URL – strip trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, '');

    this.options = {
      timeout: options.timeout ?? 30_000,
      maxRetries: options.maxRetries ?? 3,
      tokenCachePrefix: options.tokenCachePrefix ?? 'oracle:token:',
      tokenExpiryBufferSec: options.tokenExpiryBufferSec ?? 60,
    };

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: this.options.timeout,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }

  // -------------------------------------------------------------------------
  // Public HTTP methods
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

  async patch<T>(path: string, data: unknown): Promise<T> {
    return this.request<T>('PATCH', path, { data });
  }

  async delete(path: string): Promise<void> {
    await this.request<void>('DELETE', path);
  }

  // -------------------------------------------------------------------------
  // Batch operations
  // -------------------------------------------------------------------------

  async batchOperation(request: OracleBatchRequest): Promise<OracleBatchResponse> {
    const path = this.resolveBatchEndpoint(request.operation);
    return this.post<OracleBatchResponse>(path, request);
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  /**
   * Authenticate against Oracle Fusion Cloud and return a bearer token.
   * The token is cached in Redis for the duration of its validity.
   */
  async authenticate(): Promise<string> {
    const authUrl = `${this.baseUrl}/api/auth/login`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.identityDomain) {
      headers['X-Identity-Domain'] = this.identityDomain;
    }

    logger.info('Authenticating with Oracle', {
      baseUrl: this.baseUrl,
      hasIdentityDomain: !!this.identityDomain,
    });

    try {
      const response = await axios.post<Record<string, unknown>>(
        authUrl,
        { username: this.username, password: this.password },
        { headers, timeout: this.options.timeout },
      );

      const token =
        (response.data.token as string) ||
        (response.data.access_token as string) ||
        (response.data.accessToken as string);

      if (!token) {
        logger.error('Oracle auth response missing token', {
          keys: Object.keys(response.data),
        });
        throw new OracleClientError(
          401,
          ErrorCodes.AUTH_FAILED,
          'Oracle authentication response did not contain a token',
        );
      }

      // Determine token expiry from the response or default to 1 hour
      const expiresIn = (response.data.expires_in as number) || 3600;
      this.token = token;
      this.tokenExpiresAt = Date.now() + expiresIn * 1000;

      // Cache token in Redis
      try {
        const redis = getRedisClient();
        const expirySec = expiresIn - this.options.tokenExpiryBufferSec;
        if (expirySec > 0) {
          await redis.set(tokenCacheKey(this.baseUrl), token, 'EX', expirySec);
        }
      } catch (cacheErr) {
        // Redis caching is non-critical; warn and continue
        logger.warn('Failed to cache Oracle token in Redis', {
          error: (cacheErr as Error).message,
        });
      }

      logger.info('Oracle authentication successful');
      return token;
    } catch (err) {
      if (err instanceof OracleClientError) throw err;

      const axiosErr = err as AxiosError;
      const status = axiosErr.response?.status ?? 0;
      const body = axiosErr.response?.data;
      const { code, message, detail } = classifyOracleError(status, body);

      logger.error('Oracle authentication failed', {
        status,
        code,
        baseUrl: this.baseUrl,
      });

      throw new OracleClientError(status, code, message, detail, body);
    }
  }

  /**
   * Force a token refresh, bypassing the cache.
   */
  async refreshToken(): Promise<string> {
    logger.info('Force-refreshing Oracle token');
    this.token = null;
    this.tokenExpiresAt = 0;

    // Invalidate Redis cache
    try {
      const redis = getRedisClient();
      await redis.del(tokenCacheKey(this.baseUrl));
    } catch {
      // Non-critical
    }

    return this.authenticate();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Get a valid bearer token, using Redis cache first and falling back to a
   * fresh authentication if the cached token is missing or expired.
   */
  private async getValidToken(): Promise<string> {
    // Check in-memory token first
    if (this.token && Date.now() < this.tokenExpiresAt - this.options.tokenExpiryBufferSec * 1000) {
      return this.token;
    }

    // Try Redis cache
    try {
      const redis = getRedisClient();
      const cached = await redis.get(tokenCacheKey(this.baseUrl));
      if (cached) {
        this.token = cached;
        // Set a reasonable in-memory expiry since we don't know the real TTL
        this.tokenExpiresAt = Date.now() + 30 * 60 * 1000; // 30 min
        return cached;
      }
    } catch {
      // Redis unavailable – fall through to authenticate
    }

    // Authenticate fresh
    return this.authenticate();
  }

  /**
   * Central request method that:
   *  - Attaches the bearer token via Authorization header
   *  - Retries on 401 (token expired) with automatic re-authentication
   *  - Retries on 5xx / network errors with exponential backoff
   *  - Handles Oracle-specific error response formats
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    config?: { params?: Record<string, unknown>; data?: unknown },
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        const token = await this.getValidToken();

        const axiosConfig: AxiosRequestConfig = {
          method,
          url: path,
          params: config?.params,
          data: config?.data,
          headers: {
            Authorization: `Bearer ${token}`,
          },
          validateStatus: (status) => status < 400,
        };

        logger.debug('Oracle API request', {
          method,
          path,
          attempt,
          baseUrl: this.baseUrl,
        });

        const start = Date.now();
        const response = await this.http.request<T>(axiosConfig);
        const duration = Date.now() - start;

        logger.debug('Oracle API success', {
          method,
          path,
          duration,
          status: response.status,
        });

        return response.data;
      } catch (err: unknown) {
        const axiosError = err as AxiosError;
        const isTimeout =
          axiosError.code === 'ECONNABORTED' || axiosError.message?.includes('timeout');
        const isNetworkError = !axiosError.response && axiosError.isAxiosError;

        // Timeout
        if (isTimeout) {
          logger.warn('Oracle API timeout', { path, attempt });
          if (attempt < this.options.maxRetries) {
            await sleep(this.calculateBackoff(attempt));
            continue;
          }
          throw new OracleClientError(
            0,
            ErrorCodes.API_TIMEOUT,
            `Oracle request timed out after ${this.options.maxRetries} retries`,
          );
        }

        // Network error
        if (isNetworkError) {
          logger.warn('Oracle network error', {
            path,
            attempt,
            message: axiosError.message,
          });
          if (attempt < this.options.maxRetries) {
            await sleep(this.calculateBackoff(attempt));
            continue;
          }
          throw new OracleClientError(
            0,
            ErrorCodes.API_UNAVAILABLE,
            `Oracle network error: ${axiosError.message}`,
          );
        }

        // Got a response from Oracle
        if (axiosError.response) {
          const status = axiosError.response.status;
          const body = axiosError.response.data;
          const detail = extractOracleErrorDetail(body);

          // 401 – token may have expired; refresh and retry once
          if (status === 401) {
            logger.warn('Oracle 401 – attempting token refresh', { path, attempt });
            try {
              await this.refreshToken();
              if (attempt < this.options.maxRetries) {
                continue;
              }
            } catch (refreshErr) {
              logger.error('Oracle token refresh failed', {
                error: (refreshErr as Error).message,
              });
            }

            throw new OracleClientError(
              401,
              ErrorCodes.AUTH_EXPIRED,
              'Oracle authentication expired and refresh failed',
            );
          }

          // 5xx – retry with backoff
          if (status >= 500 && attempt < this.options.maxRetries) {
            logger.warn('Oracle server error, retrying', {
              status,
              path,
              attempt,
            });
            await sleep(this.calculateBackoff(attempt));
            continue;
          }

          // 4xx (non-401) – do not retry
          const { code, message } = classifyOracleError(status, body);
          throw new OracleClientError(status, code, message, detail, body);
        }

        // Any other error
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt >= this.options.maxRetries) {
          break;
        }

        await sleep(this.calculateBackoff(attempt));
      }
    }

    throw lastError ?? new Error('Oracle request failed (unknown error)');
  }

  /**
   * Resolve the batch endpoint path for a given operation type.
   */
  private resolveBatchEndpoint(operation: string): string {
    switch (operation) {
      case 'CREATE':
        return '/api/batch/create';
      case 'UPDATE':
        return '/api/batch/update';
      case 'DELETE':
        return '/api/batch/delete';
      case 'UPSERT':
        return '/api/batch/upsert';
      default:
        return '/api/batch';
    }
  }

  /**
   * Exponential backoff with full jitter.
   */
  private calculateBackoff(attempt: number): number {
    const baseMs = 1_000;
    const maxMs = 60_000;
    const delay = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
    return Math.round(Math.random() * delay);
  }
}

export default OracleClient;
