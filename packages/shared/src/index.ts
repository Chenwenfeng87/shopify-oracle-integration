/**
 * @shopify-oracle/shared
 *
 * Shared types, constants, and utilities for the Shopify-Oracle integration
 * monorepo. This package is consumed by all other workspace packages.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type {
  PaginationParams,
  PaginatedResponse,
  ApiResponse,
  HealthCheckResponse,
  ShopifyProduct,
  ShopifyVariant,
  ShopifyImage,
  ShopifyOption,
  ShopifyCustomer,
  ShopifyAddress,
  ShopifyOrder,
  ShopifyLineItem,
  ShopifyInventoryLevel,
  ShopifyInventoryItem,
  ShopifyPriceRule,
  ShopifyWebhook,
  ShopifyMetafield,
  ShopifyWebhookTopic,
  OracleItem,
  OracleCustomer,
  OracleAddress,
  OraclePrice,
  OracleSalesOrder,
  OracleOrderLine,
  OracleInventoryItem,
  OracleBatchRequest,
  OracleBatchResponse,
  OracleBatchError,
  EntityType,
  SyncDirection,
  SyncStatus,
  SyncTrigger,
  SyncFrequency,
  ConflictStrategy,
  SyncAction,
  SyncJob,
  SyncLog,
  SyncConfig,
  FieldMapping,
  TransformRule,
  SyncQueueMessage,
  SyncResult,
  SyncError,
  EntitySyncHandler,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export {
  SYNC_STATUS_LABELS,
  ENTITY_TYPE_LABELS,
  SYNC_TRIGGER_LABELS,
  CONFLICT_STRATEGY_LABELS,
  SYNC_DIRECTION_LABELS,
  ENTITY_TYPES,
  ENTITY_SYNC_DIRECTIONS,
  SHOPIFY_REQUIRED_SCOPES,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  MAX_RETRIES,
  ErrorCodes,
} from './constants';
export type { ErrorCode } from './constants';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
export {
  withRetry,
  isRetryableError,
  calculateBackoff,
  mapRecord,
  applyTransform,
  getNestedValue,
  setNestedValue,
  shopifyDomainSchema,
  oracleUrlSchema,
  syncConfigSchema,
  fieldMappingSchema,
  transformRuleSchema,
  validateShopifyDomain,
  validateOracleUrl,
  validateSyncConfig,
} from './utils';
export type {
  RetryOptions,
  FieldMappingDef,
  SyncConfigInput,
  FieldMappingInput,
} from './utils';
