/**
 * Central registry of error codes used across the integration.
 *
 * These codes are used in API responses, sync logs, and queue messages
 * to provide consistent error categorization throughout the system.
 */
export const ErrorCodes = {
  /** Authentication with the external system failed (invalid credentials). */
  AUTH_FAILED: 'AUTH_FAILED',

  /** Previously valid authentication has expired and needs renewal. */
  AUTH_EXPIRED: 'AUTH_EXPIRED',

  /** API rate limit has been exceeded; back off before retrying. */
  API_RATE_LIMIT: 'API_RATE_LIMIT',

  /** API request exceeded the configured timeout duration. */
  API_TIMEOUT: 'API_TIMEOUT',

  /** External API is currently unavailable (e.g., down for maintenance). */
  API_UNAVAILABLE: 'API_UNAVAILABLE',

  /** Input data failed validation checks. */
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  /** The sync operation itself failed. */
  SYNC_FAILED: 'SYNC_FAILED',

  /** A data conflict was detected during sync (e.g., version mismatch). */
  CONFLICT_DETECTED: 'CONFLICT_DETECTED',

  /** The requested record was not found in the source or target system. */
  RECORD_NOT_FOUND: 'RECORD_NOT_FOUND',

  /** An error occurred while publishing or consuming a queue message. */
  QUEUE_ERROR: 'QUEUE_ERROR',

  /** A database operation failed. */
  DATABASE_ERROR: 'DATABASE_ERROR',

  /** An encryption or decryption operation failed. */
  ENCRYPTION_ERROR: 'ENCRYPTION_ERROR',

  /** The application or integration configuration is invalid. */
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',

  /** Webhook signature verification failed — the payload may be spoofed. */
  WEBHOOK_VERIFICATION_FAILED: 'WEBHOOK_VERIFICATION_FAILED',

  /** A billing plan or payment is required to access this feature. */
  BILLING_REQUIRED: 'BILLING_REQUIRED',
} as const;

/** Union type of all error code values. */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
