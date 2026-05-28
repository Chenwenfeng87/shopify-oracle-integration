export type EntityType = 'item' | 'customer' | 'order' | 'price' | 'inventory';

export type SyncDirection = 'shopify_to_oracle' | 'oracle_to_shopify';

export type SyncStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'partial';

export type SyncTrigger = 'manual' | 'scheduled' | 'webhook';

export type SyncFrequency = 'real_time' | 'scheduled' | 'manual';

export type ConflictStrategy = 'source_wins' | 'target_wins' | 'manual' | 'merge';

export type SyncAction = 'created' | 'updated' | 'skipped' | 'failed';

export interface SyncJob {
  id: string;
  storeId: string;
  entityType: EntityType;
  direction: SyncDirection;
  status: SyncStatus;
  trigger: SyncTrigger;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  startedAt: Date | null;
  completedAt: Date | null;
  errorSummary: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncLog {
  id: string;
  syncJobId: string;
  recordId: string;
  action: SyncAction;
  sourceData: Record<string, unknown> | null;
  targetData: Record<string, unknown> | null;
  conflictDetected: boolean;
  conflictResolution: ConflictStrategy | null;
  errorMessage: string | null;
  createdAt: Date;
}

export interface SyncConfig {
  id: string;
  storeId: string;
  entityType: EntityType;
  frequency: SyncFrequency;
  cronExpression: string | null;
  isEnabled: boolean;
  batchSize: number;
  conflictStrategy: ConflictStrategy;
  createdAt: Date;
  updatedAt: Date;
}

export interface FieldMapping {
  id: string;
  storeId: string;
  entityType: EntityType;
  direction: SyncDirection;
  shopifyField: string;
  oracleField: string;
  transformRule: TransformRule | null;
  isRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransformRule {
  type: 'direct' | 'concat' | 'split' | 'formula' | 'lookup' | 'date_format' | 'custom';
  config: Record<string, unknown>;
}

export interface SyncQueueMessage {
  jobId: string;
  storeId: string;
  entityType: EntityType;
  direction: SyncDirection;
  batchIndex: number;
  totalBatches: number;
  records: Record<string, unknown>[];
  retryCount: number;
  maxRetries: number;
}

export interface SyncResult {
  jobId: string;
  batchIndex: number;
  entityType: EntityType;
  processed: number;
  succeeded: number;
  failed: number;
  errors: SyncError[];
  completedAt: string;
}

export interface SyncError {
  recordId: string;
  errorCode: string;
  errorMessage: string;
  context: Record<string, unknown>;
}

export interface EntitySyncHandler<T> {
  fetchFromSource(storeId: string, params: Record<string, unknown>): Promise<T[]>;
  transform(data: T[], mappings: FieldMapping[], direction: SyncDirection): Promise<Record<string, unknown>[]>;
  pushToTarget(storeId: string, data: Record<string, unknown>[]): Promise<SyncResult>;
  resolveConflicts?(
    source: T,
    target: Record<string, unknown>,
    strategy: ConflictStrategy,
  ): Promise<Record<string, unknown>>;
}
