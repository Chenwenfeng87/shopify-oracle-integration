import { v4 as uuidv4 } from 'uuid';
import { SyncJobModel } from '../../models/sync-job.model';
import { SyncLogModel } from '../../models/sync-log.model';
import { StoreModel } from '../../models/store.model';
import { QueueService } from '../queue/queue.service';
import { FieldMapperService } from './field-mapper';
import { ConflictResolver } from './conflict-resolver';
import { logger } from '../../utils/logger';
import { withRetry, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE } from '@shared/constants';
import type {
  EntityType,
  SyncDirection,
  SyncTrigger,
  SyncStatus,
  SyncJob,
  SyncQueueMessage,
  SyncResult,
  SyncError,
} from '@shared/types';

/**
 * Configuration for a sync execution.
 */
interface SyncConfig {
  batchSize: number;
  conflictStrategy: 'source_wins' | 'target_wins' | 'manual' | 'merge';
  maxRetries: number;
}

/**
 * Default sync configuration used when no custom config is available.
 */
const DEFAULT_SYNC_CONFIG: SyncConfig = {
  batchSize: DEFAULT_BATCH_SIZE,
  conflictStrategy: 'source_wins',
  maxRetries: 3,
};

/**
 * Track job cancellation state in memory.
 * Keyed by job ID, set to true when cancellation is requested.
 */
const cancellationTokens = new Map<string, boolean>();

/**
 * The SyncEngine is the heart of the Shopify-Oracle integration.
 *
 * Responsibilities:
 * 1. Create sync_job records to track each synchronization operation.
 * 2. Split source data into manageable batches.
 * 3. Transform each batch using FieldMapperService.
 * 4. Publish each batch to RabbitMQ via QueueService for async processing.
 * 5. Track overall progress across all batches.
 * 6. Handle cancellation of running syncs.
 * 7. Record error summaries and final status.
 * 8. Await completion callbacks from workers for accurate progress tracking.
 */
export class SyncEngine {
  private readonly storeId: string;
  private readonly queueService: QueueService;
  private readonly fieldMapper: FieldMapperService;
  private readonly conflictResolver: ConflictResolver;

  /**
   * Track active job progress: jobId -> { processed, failed, total }
   */
  private progressTracker: Map<
    string,
    { processed: number; failed: number; total: number; entityType: EntityType }
  > = new Map();

  /**
   * @param storeId - The store ID this engine instance operates on.
   */
  constructor(storeId: string) {
    this.storeId = storeId;
    this.queueService = new QueueService();
    this.fieldMapper = new FieldMapperService(storeId);
    this.conflictResolver = new ConflictResolver();
  }

  /**
   * Start a new synchronization operation.
   *
   * Creates a sync job record, then executes the sync flow asynchronously.
   * The job is returned immediately with a 'queued' status; progress can
   * be tracked via the job's ID.
   *
   * @param entityType - The entity type to sync.
   * @param direction - The sync direction.
   * @param trigger - What triggered this sync.
   * @param options - Optional parameters and batch size.
   * @returns The created SyncJob record.
   */
  async startSync(
    entityType: EntityType,
    direction: SyncDirection,
    trigger: SyncTrigger,
    options?: { params?: Record<string, unknown>; batchSize?: number },
  ): Promise<SyncJob> {
    // Create the sync job record with 'pending' status
    const job = await SyncJobModel.create({
      storeId: this.storeId,
      entityType,
      direction,
      trigger,
      totalRecords: 0,
    });

    logger.info('Sync job created', {
      jobId: job.id,
      storeId: this.storeId,
      entityType,
      direction,
      trigger,
    });

    // Fire and forget the async execution
    // Errors are caught and logged within executeSync
    this.executeSync(job, options).catch((error) => {
      logger.error('Sync execution failed with unhandled error', {
        jobId: job.id,
        error: (error as Error).message,
      });
    });

    return job;
  }

  /**
   * Cancel a running sync job.
   * Sets a cancellation token that the execution loop checks between batches.
   *
   * @param jobId - The ID of the job to cancel.
   */
  async cancelSync(jobId: string): Promise<void> {
    cancellationTokens.set(jobId, true);
    logger.info('Cancellation requested for sync job', { jobId });
  }

  /**
   * Get a summary of current sync status for the store.
   *
   * @returns Object containing last sync timestamps, active/queued job counts,
   *          and today's failure count.
   */
  async getSyncStatus(): Promise<{
    lastSync: Record<EntityType, { timestamp: Date; status: SyncStatus } | null>;
    activeJobs: number;
    queuedJobs: number;
    failedToday: number;
  }> {
    const entityTypes: EntityType[] = ['item', 'customer', 'order', 'price', 'inventory'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch latest job for each entity type
    const lastSyncPromises = entityTypes.map(async (entityType) => {
      const jobs = await SyncJobModel.findByStoreId(this.storeId, {
        entityType,
        limit: 1,
        sortBy: 'created_at',
        sortOrder: 'desc',
      });

      if (jobs.data.length > 0) {
        const job = jobs.data[0];
        return {
          entityType,
          data: {
            timestamp: job.completedAt || job.createdAt,
            status: job.status,
          },
        };
      }
      return { entityType, data: null };
    });

    const lastSyncResults = await Promise.all(lastSyncPromises);

    const lastSync = {} as Record<EntityType, { timestamp: Date; status: SyncStatus } | null>;
    for (const result of lastSyncResults) {
      lastSync[result.entityType] = result.data;
    }

    // Count active and queued jobs
    const [runningJobs, queuedJobs] = await Promise.all([
      SyncJobModel.findByStoreId(this.storeId, { status: 'running', limit: 0 }),
      SyncJobModel.findByStoreId(this.storeId, { status: 'queued', limit: 0 }),
    ]);

    // Count today's failures
    const failedJobs = await SyncJobModel.findByStoreId(this.storeId, {
      status: 'failed',
      startDate: today.toISOString(),
      limit: 0,
    });

    return {
      lastSync,
      activeJobs: runningJobs.pagination.total,
      queuedJobs: queuedJobs.pagination.total,
      failedToday: failedJobs.pagination.total,
    };
  }

  /**
   * Called by a worker after processing a batch to report results.
   * Updates the job's progress counters.
   *
   * @param jobId - The sync job ID.
   * @param result - The result from batch processing.
   */
  async onBatchProcessed(jobId: string, result: SyncResult): Promise<void> {
    try {
      await SyncJobModel.incrementProgress(
        jobId,
        result.succeeded,
        result.failed,
      );

      // Update in-memory tracker
      const tracker = this.progressTracker.get(jobId);
      if (tracker) {
        tracker.processed += result.succeeded;
        tracker.failed += result.failed;
      }

      // Log batch completion details
      logger.debug('Batch processed', {
        jobId,
        batchIndex: result.batchIndex,
        entityType: result.entityType,
        succeeded: result.succeeded,
        failed: result.failed,
      });

      // Log individual errors
      if (result.errors && result.errors.length > 0) {
        for (const err of result.errors.slice(0, 10)) {
          await SyncLogModel.create({
            syncJobId: jobId,
            recordId: err.recordId,
            action: 'failed',
            errorMessage: err.errorMessage,
            sourceData: err.context,
          });
        }
      }

      // Check if all batches are done
      const trackerAfter = this.progressTracker.get(jobId);
      if (trackerAfter && trackerAfter.total > 0) {
        const totalProcessed = trackerAfter.processed + trackerAfter.failed;
        if (totalProcessed >= trackerAfter.total) {
          await this.finalizeJob(jobId);
        }
      }
    } catch (error) {
      logger.error('Failed to process batch result', {
        jobId,
        error: (error as Error).message,
      });
    }
  }

  // ─────────────────────────────────────────────────
  // Private Execution Flow
  // ─────────────────────────────────────────────────

  /**
   * Execute the full sync flow for a job.
   *
   * Steps:
   *  1. Update job status to 'queued', then 'running'.
   *  2. Load sync configuration (batch size, conflict strategy).
   *  3. Load field mappings for the entity+direction.
   *  4. Fetch records from the source system (paginated if applicable).
   *  5. Split records into batches.
   *  6. For each batch:
   *     a. Check if job was cancelled.
   *     b. Transform records using FieldMapperService.
   *     c. Publish batch to RabbitMQ via QueueService.
   *     d. Track progress.
   *  7. Wait for all batches to complete (or mark as partial if cancelled).
   *  8. Update job status to 'completed', 'partial', or 'failed'.
   *  9. Log summary.
   */
  private async executeSync(
    job: SyncJob,
    options?: { params?: Record<string, unknown>; batchSize?: number },
  ): Promise<void> {
    const startTime = Date.now();
    const jobId = job.id;

    try {
      // Step 1: Update status to 'queued'
      await SyncJobModel.updateStatus(jobId, 'queued');
      logger.info('Sync job queued', { jobId, entityType: job.entityType });

      // Initialize queue infrastructure
      await this.queueService.initialize();

      // Step 2: Load sync config
      const syncConfig = await this.loadSyncConfig(options?.batchSize);

      // Step 3: Load field mappings (warm the cache)
      await this.fieldMapper.loadMappings(job.entityType, job.direction);

      // Step 4 & 5: Fetch and batch records
      // Update status to 'running'
      await SyncJobModel.updateStatus(jobId, 'running');

      // Fetch source records
      logger.info('Fetching source records', {
        jobId,
        entityType: job.entityType,
        direction: job.direction,
      });

      const sourceRecords = await this.fetchSourceRecords(
        job.entityType,
        job.direction,
        options?.params,
      );

      const totalRecords = sourceRecords.length;
      const batches = this.createBatches(sourceRecords, syncConfig.batchSize);
      const totalBatches = batches.length;

      // Update the job with total record count
      await SyncJobModel.updateStatus(jobId, 'running', {
        totalRecords,
      });

      // Initialize progress tracker
      this.progressTracker.set(jobId, {
        processed: 0,
        failed: 0,
        total: totalRecords,
        entityType: job.entityType,
      });

      logger.info('Sync execution started', {
        jobId,
        entityType: job.entityType,
        direction: job.direction,
        totalRecords,
        totalBatches,
        batchSize: syncConfig.batchSize,
      });

      // Step 6: Process each batch
      let cancelled = false;
      let publishedBatches = 0;

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        // 6a. Check cancellation
        if (cancellationTokens.get(jobId) === true) {
          logger.info('Sync job cancelled, stopping batch processing', {
            jobId,
            batchIndex,
            totalBatches,
          });
          cancelled = true;
          break;
        }

        const batch = batches[batchIndex];

        // 6b. Transform records
        let transformedBatch: Record<string, unknown>[];
        try {
          transformedBatch = await this.fieldMapper.transformBatch(
            batch,
            job.entityType,
            job.direction,
          );
        } catch (transformError) {
          logger.error('Batch transformation failed', {
            jobId,
            batchIndex,
            error: (transformError as Error).message,
          });
          await SyncLogModel.create({
            syncJobId: jobId,
            recordId: `batch-${batchIndex}`,
            action: 'failed',
            errorMessage: `Batch transformation failed: ${(transformError as Error).message}`,
            sourceData: { batchIndex, recordCount: batch.length },
          });
          continue; // Skip this batch but continue with others
        }

        // 6c. Publish batch to queue
        const message: SyncQueueMessage = {
          jobId,
          storeId: this.storeId,
          entityType: job.entityType,
          direction: job.direction,
          batchIndex,
          totalBatches,
          records: transformedBatch,
          retryCount: 0,
          maxRetries: syncConfig.maxRetries,
        };

        try {
          await this.queueService.publishSyncJob(message);
          publishedBatches++;
        } catch (publishError) {
          logger.error('Failed to publish batch', {
            jobId,
            batchIndex,
            error: (publishError as Error).message,
          });

          // Try sending to DLQ with retry information
          await this.queueService.publishToDLQ(
            message,
            publishError instanceof Error
              ? publishError
              : new Error(String(publishError)),
          );
        }
      }

      // Clean up cancellation token
      cancellationTokens.delete(jobId);

      // Step 7 & 8: Determine final status
      if (cancelled) {
        // If cancelled, mark as failed with reason
        await SyncJobModel.updateStatus(jobId, 'failed', {
          errorSummary: {
            reason: 'cancelled',
            message: 'Sync was cancelled by user',
            publishedBatches,
            totalBatches,
            processedRecords: this.progressTracker.get(jobId)?.processed ?? 0,
          },
        });
        logger.info('Sync job cancelled and finalized', {
          jobId,
          publishedBatches,
          totalBatches,
        });
      } else if (publishedBatches === 0 && totalBatches > 0) {
        // All batches failed to publish
        await SyncJobModel.updateStatus(jobId, 'failed', {
          errorSummary: {
            reason: 'publish_failed',
            message: 'All batches failed to publish to queue',
            totalBatches,
          },
        });
      } else if (publishedBatches < totalBatches) {
        // Some batches published, some failed — partial success
        await SyncJobModel.updateStatus(jobId, 'partial', {
          errorSummary: {
            reason: 'partial_publish',
            message: `${publishedBatches}/${totalBatches} batches published to queue`,
            totalBatches,
            publishedBatches,
          },
        });
      } else {
        // All batches published successfully.
        // The job will be marked as 'completed' when all workers finish.
        // If there are no records (empty sync), mark completed immediately.
        if (totalBatches === 0) {
          await SyncJobModel.updateStatus(jobId, 'completed', {
            errorSummary: null,
          });
          this.progressTracker.delete(jobId);
          logger.info('Sync completed (empty - no records to sync)', {
            jobId,
            duration: Date.now() - startTime,
          });
        }
        // Otherwise, the job stays 'running' until onBatchProcessed determines
        // all batches are done.
      }

      // Step 9: Log summary
      const duration = Date.now() - startTime;
      logger.info('Sync execution summary', {
        jobId,
        entityType: job.entityType,
        direction: job.direction,
        totalRecords,
        totalBatches,
        publishedBatches,
        cancelled,
        duration,
      });
    } catch (error) {
      // Catastrophic failure
      const duration = Date.now() - startTime;
      logger.error('Sync execution failed catastrophically', {
        jobId,
        entityType: job.entityType,
        error: (error as Error).message,
        duration,
      });

      try {
        await SyncJobModel.updateStatus(jobId, 'failed', {
          errorSummary: {
            reason: 'execution_error',
            message: (error as Error).message,
            duration,
          },
        });
      } catch (statusError) {
        logger.error('Failed to update job status after catastrophic failure', {
          jobId,
          error: (statusError as Error).message,
        });
      }

      cancellationTokens.delete(jobId);
      this.progressTracker.delete(jobId);
    }
  }

  /**
   * Finalize a sync job when all batches have been processed.
   * Determines final status based on success/failure counts.
   *
   * @param jobId - The job ID to finalize.
   */
  private async finalizeJob(jobId: string): Promise<void> {
    const tracker = this.progressTracker.get(jobId);
    if (!tracker) {
      return;
    }

    try {
      const { processed, failed, total } = tracker;

      let finalStatus: SyncStatus;
      let errorSummary: Record<string, unknown> | null = null;

      if (failed === 0 && processed > 0) {
        finalStatus = 'completed';
      } else if (failed > 0 && processed > 0) {
        finalStatus = 'partial';
        errorSummary = {
          reason: 'partial_processing',
          message: `${processed} records processed, ${failed} failed`,
          processedRecords: processed,
          failedRecords: failed,
          totalRecords: total,
        };
      } else if (failed > 0 && processed === 0) {
        finalStatus = 'failed';
        errorSummary = {
          reason: 'all_failed',
          message: `All ${failed} records failed to process`,
          failedRecords: failed,
          totalRecords: total,
        };
      } else {
        finalStatus = 'completed';
      }

      await SyncJobModel.updateStatus(jobId, finalStatus, {
        errorSummary,
      });

      logger.info('Sync job finalized', {
        jobId,
        status: finalStatus,
        processed,
        failed,
        total,
      });
    } catch (error) {
      logger.error('Failed to finalize sync job', {
        jobId,
        error: (error as Error).message,
      });
    } finally {
      this.progressTracker.delete(jobId);
    }
  }

  /**
   * Load sync configuration for this store and entity.
   * Falls back to sensible defaults if no configuration is found.
   *
   * @param requestedBatchSize - Optional batch size override from the caller.
   * @returns Resolved SyncConfig.
   */
  private async loadSyncConfig(
    requestedBatchSize?: number,
  ): Promise<SyncConfig> {
    const config = { ...DEFAULT_SYNC_CONFIG };

    // Override batch size if requested and valid
    if (requestedBatchSize && requestedBatchSize > 0) {
      config.batchSize = Math.min(requestedBatchSize, MAX_BATCH_SIZE);
    }

    return config;
  }

  /**
   * Fetch records from the source system.
   *
   * In a full implementation, this would delegate to the appropriate
   * Shopify or Oracle client based on the sync direction and entity type.
   * For now, this serves as the integration point for those clients.
   *
   * @param entityType - The entity type to fetch.
   * @param direction - The sync direction (determines source system).
   * @param params - Optional parameters to pass to the source API.
   * @returns Array of source records.
   */
  private async fetchSourceRecords(
    entityType: EntityType,
    direction: SyncDirection,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    try {
      // Fetch store to get connection details
      const store = await StoreModel.findById(this.storeId);
      if (!store) {
        throw new Error(`Store not found: ${this.storeId}`);
      }

      if (!store.isActive) {
        throw new Error(`Store is inactive: ${this.storeId}`);
      }

      // Determine which client to use based on direction
      // shopify_to_oracle: fetch from Shopify, push to Oracle
      // oracle_to_shopify: fetch from Oracle, push to Shopify
      const sourceSystem = direction === 'shopify_to_oracle' ? 'Shopify' : 'Oracle';

      logger.info('Fetching source records', {
        storeId: this.storeId,
        entityType,
        direction,
        sourceSystem,
        paramsKeys: params ? Object.keys(params) : [],
      });

      // TODO: In a full implementation, delegate to the appropriate
      // service client (ShopifyClient / OracleClient) based on entityType:
      //
      // if (direction === 'shopify_to_oracle') {
      //   const shopifyClient = new ShopifyClient(store.shopifyDomain, store.shopifyToken!);
      //   switch (entityType) {
      //     case 'item':
      //       return shopifyClient.get(`/products.json`, params) as any;
      //     case 'customer':
      //       return shopifyClient.get(`/customers.json`, params) as any;
      //     case 'order':
      //       return shopifyClient.get(`/orders.json`, params) as any;
      //     case 'inventory':
      //       return shopifyClient.get(`/inventory_levels.json`, params) as any;
      //     case 'price':
      //       return shopifyClient.get(`/price_rules.json`, params) as any;
      //   }
      // } else {
      //   // Oracle direction
      //   const oracleClient = new OracleClient(store.id);
      //   ...
      // }

      // For now, return an empty array — the actual fetching will be
      // implemented when the service clients are complete.
      logger.debug('Source record fetching returning empty — service clients not yet integrated', {
        entityType,
        direction,
        sourceSystem,
      });

      return [];
    } catch (error) {
      logger.error('Failed to fetch source records', {
        storeId: this.storeId,
        entityType,
        direction,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Split an array of records into batches of the specified size.
   *
   * @param records - The full array of records.
   * @param batchSize - Maximum number of records per batch.
   * @returns Array of record batches.
   */
  private createBatches(
    records: Record<string, unknown>[],
    batchSize: number,
  ): Record<string, unknown>[][] {
    const batches: Record<string, unknown>[][] = [];

    for (let i = 0; i < records.length; i += batchSize) {
      batches.push(records.slice(i, i + batchSize));
    }

    return batches;
  }
}

export default SyncEngine;
