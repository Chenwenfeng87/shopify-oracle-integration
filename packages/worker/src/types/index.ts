// ============================================================================
// Shared Type Definitions for Shopify-Oracle Integration Worker
// ============================================================================

/** Supported entity types for synchronization */
export type EntityType = 'item' | 'customer' | 'order' | 'price' | 'inventory';

/** Sync direction between systems */
export type SyncDirection = 'shopify_to_oracle' | 'oracle_to_shopify';

/** Status values for a sync job */
export type JobStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'partial';

/** How a sync job was triggered */
export type JobTrigger = 'manual' | 'scheduled' | 'webhook';

/** Log action types for individual record processing */
export type LogAction = 'created' | 'updated' | 'skipped' | 'failed';

/** Conflict resolution strategy */
export type ConflictStrategy = 'source_wins' | 'target_wins' | 'manual' | 'merge';

/** Sync frequency options */
export type SyncFrequency = 'real_time' | 'scheduled' | 'manual';

// ============================================================================
// Database Row Types
// ============================================================================

export interface StoreRow {
  id: string;
  shopify_domain: string;
  access_token: string | null;
  scope: string | null;
  is_active: boolean;
  installed_at: Date;
  uninstalled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface OracleCredentialsRow {
  id: string;
  store_id: string;
  base_url: string;
  username: string;
  password: string;
  identity_domain: string | null;
  is_valid: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface FieldMappingRow {
  id: string;
  store_id: string;
  entity_type: EntityType;
  direction: SyncDirection;
  shopify_field: string;
  oracle_field: string;
  transform_rule: Record<string, unknown> | null;
  is_required: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface SyncConfigRow {
  id: string;
  store_id: string;
  entity_type: EntityType;
  frequency: SyncFrequency;
  cron_expression: string | null;
  is_enabled: boolean;
  batch_size: number;
  conflict_strategy: ConflictStrategy;
  created_at: Date;
  updated_at: Date;
}

export interface SyncJobRow {
  id: string;
  store_id: string;
  entity_type: EntityType;
  direction: SyncDirection;
  status: JobStatus;
  trigger: JobTrigger;
  total_records: number;
  processed_records: number;
  failed_records: number;
  started_at: Date | null;
  completed_at: Date | null;
  error_summary: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface SyncLogRow {
  id: string;
  sync_job_id: string;
  record_id: string;
  action: LogAction;
  source_data: Record<string, unknown> | null;
  target_data: Record<string, unknown> | null;
  conflict_detected: boolean;
  conflict_resolution: string | null;
  error_message: string | null;
  created_at: Date;
}

// ============================================================================
// Message Queue Types
// ============================================================================

/**
 * Message payload sent via RabbitMQ to trigger sync processing.
 */
export interface SyncQueueMessage {
  jobId: string;
  storeId: string;
  entityType: EntityType;
  direction: SyncDirection;
  trigger: JobTrigger;
  records: SyncRecord[];
  config: SyncConfigRow;
  mappings: FieldMappingRow[];
  timestamp: string;
  retryCount: number;
}

/**
 * A single record to be synchronized.
 */
export interface SyncRecord {
  id: string;
  data: Record<string, unknown>;
}

// ============================================================================
// API Response Types
// ============================================================================

/** Oracle Netsuite REST API response wrapper */
export interface OracleApiResponse<T = unknown> {
  items: T[];
  totalResults: number;
  hasMore: boolean;
  offset: number;
  limit: number;
}

/** Shopify Admin API response wrapper for products */
export interface ShopifyProductResponse {
  product: {
    id: number;
    title: string;
    body_html: string | null;
    vendor: string | null;
    product_type: string | null;
    status: string;
    variants: ShopifyVariant[];
    [key: string]: unknown;
  };
}

/** Shopify variant object */
export interface ShopifyVariant {
  id: number;
  product_id: number;
  sku: string;
  price: string;
  inventory_quantity: number;
  [key: string]: unknown;
}

/** Shopify customer response */
export interface ShopifyCustomerResponse {
  customer: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    [key: string]: unknown;
  };
}

/** Shopify order response */
export interface ShopifyOrderResponse {
  order: {
    id: number;
    order_number: number;
    total_price: string;
    [key: string]: unknown;
  };
}

// ============================================================================
// Credential & Auth Types
// ============================================================================

/** Oracle authentication token response */
export interface OracleAuthResponse {
  token: string;
  tokenType: string;
  expiresIn: number;
}

/** Worker configuration loaded from environment */
export interface WorkerConfig {
  rabbitmqUrl: string;
  postgresUrl: string;
  redisUrl: string;
  shopifyApiVersion: string;
  maxRetries: number;
  dlqSuffix: string;
  prefetchCount: number;
  heartbeatInterval: number;
  logLevel: string;
}

// ============================================================================
// Result Types
// ============================================================================

/** Result of processing a single record */
export interface RecordResult {
  recordId: string;
  action: LogAction;
  sourceData: Record<string, unknown> | null;
  targetData: Record<string, unknown> | null;
  conflictDetected: boolean;
  conflictResolution: string | null;
  errorMessage: string | null;
}

/** Overall result of processing a batch */
export interface BatchResult {
  jobId: string;
  storeId: string;
  entityType: EntityType;
  direction: SyncDirection;
  processedRecords: number;
  failedRecords: number;
  results: RecordResult[];
  completedAt: string;
}
