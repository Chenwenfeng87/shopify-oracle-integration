import cron from 'node-cron';
import { SyncJobModel } from '../models/sync-job.model';
import { StoreModel } from '../models/store.model';
import { SyncEngine } from '../services/sync/sync-engine';
import { logger } from '../utils/logger';
import type { EntityType, SyncDirection } from '@shared/types';
import { ENTITY_SYNC_DIRECTIONS } from '@shared/constants';

/**
 * Key format for the scheduled jobs map: "storeId:entityType".
 */
type ScheduleKey = string;

/**
 * Validates and normalizes a cron expression.
 * Ensures the expression is syntactically valid before creating a schedule.
 */
function isValidCronExpression(expression: string): boolean {
  return cron.validate(expression);
}

/**
 * The SyncScheduler manages cron-based scheduled synchronizations.
 *
 * For each store+entity combination that has a configured schedule, a
 * node-cron job is created. The scheduler prevents duplicate syncs from
 * running concurrently for the same store and entity type.
 *
 * Schedules are loaded from the database on initialization and can be
 * dynamically added or removed at runtime.
 */
export class SyncScheduler {
  /**
   * Map of schedule keys to node-cron ScheduledTask instances.
   * Key format: "storeId:entityType"
   */
  private jobs: Map<ScheduleKey, cron.ScheduledTask> = new Map();

  /**
   * Whether the scheduler has been initialized.
   */
  private initialized = false;

  /**
   * Initialize the scheduler by loading all active stores and their
   * sync configurations, then creating cron jobs for each.
   *
   * Safe to call multiple times — subsequent calls are no-ops once
   * initialized unless reload() is called first.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('SyncScheduler already initialized');
      return;
    }

    try {
      logger.info('Initializing sync scheduler...');

      // Load all active stores
      const stores = await StoreModel.list(true);

      if (stores.length === 0) {
        logger.info('No active stores found, scheduler initialized with no jobs');
        this.initialized = true;
        return;
      }

      // For each store, check for scheduled sync configs and create jobs.
      // In a full implementation, this would load SyncConfig records from
      // a dedicated sync_configs table. For now, we check sync job history
      // to find stores with scheduled triggers.
      let totalJobsCreated = 0;

      for (const store of stores) {
        const entityTypes: EntityType[] = ['item', 'customer', 'order', 'price', 'inventory'];

        for (const entityType of entityTypes) {
          // Check if there's an existing scheduled sync config for this store+entity
          // TODO: Load from a sync_configs table when available
          const hasSchedule = await this.hasExistingSchedule(store.id, entityType);

          if (hasSchedule) {
            // Use a default hourly schedule if a scheduled config exists
            // In production, the cron expression would come from the sync_configs table
            const defaultCron = '0 * * * *'; // Every hour
            await this.scheduleSync(store.id, entityType, defaultCron);
            totalJobsCreated++;
          }
        }
      }

      this.initialized = true;
      logger.info('Sync scheduler initialized', {
        stores: stores.length,
        scheduledJobs: totalJobsCreated,
      });
    } catch (error) {
      logger.error('Failed to initialize sync scheduler', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Schedule a cron-based sync for a specific store and entity type.
   *
   * @param storeId - The store ID to schedule for.
   * @param entityType - The entity type to sync.
   * @param cronExpression - A valid cron expression for the schedule.
   */
  async scheduleSync(
    storeId: string,
    entityType: EntityType,
    cronExpression: string,
  ): Promise<void> {
    const key = this.buildKey(storeId, entityType);

    // Validate cron expression
    if (!isValidCronExpression(cronExpression)) {
      throw new Error(
        `Invalid cron expression "${cronExpression}" for store ${storeId} entity ${entityType}`,
      );
    }

    // Remove existing schedule if present
    if (this.jobs.has(key)) {
      await this.unscheduleSync(storeId, entityType);
    }

    const defaultDirection = ENTITY_SYNC_DIRECTIONS[entityType].defaultDirection;

    const task = cron.schedule(cronExpression, async () => {
      try {
        // Check for duplicate running sync
        const isRunning = await this.isSyncRunning(storeId, entityType);
        if (isRunning) {
          logger.warn('Scheduled sync skipped — sync already running', {
            storeId,
            entityType,
          });
          return;
        }

        logger.info('Scheduled sync triggered', {
          storeId,
          entityType,
          direction: defaultDirection,
          cronExpression,
        });

        const syncEngine = new SyncEngine(storeId);
        await syncEngine.startSync(
          entityType,
          defaultDirection,
          'scheduled',
        );
      } catch (error) {
        logger.error('Scheduled sync execution failed', {
          storeId,
          entityType,
          error: (error as Error).message,
        });
      }
    });

    this.jobs.set(key, task);

    logger.info('Sync scheduled', {
      storeId,
      entityType,
      cronExpression,
      direction: defaultDirection,
    });
  }

  /**
   * Remove a scheduled sync for a store and entity type.
   * Stops the cron task and removes it from the internal map.
   *
   * @param storeId - The store ID to unschedule.
   * @param entityType - The entity type to unschedule.
   */
  async unscheduleSync(
    storeId: string,
    entityType: EntityType,
  ): Promise<void> {
    const key = this.buildKey(storeId, entityType);
    const task = this.jobs.get(key);

    if (task) {
      task.stop();
      this.jobs.delete(key);
      logger.info('Sync unscheduled', { storeId, entityType });
    } else {
      logger.debug('No scheduled sync found to unschedule', {
        storeId,
        entityType,
      });
    }
  }

  /**
   * Reload all schedules from the database.
   * Stops all existing cron jobs and re-initializes.
   * Useful after configuration changes.
   */
  async reload(): Promise<void> {
    logger.info('Reloading all sync schedules...');
    await this.shutdown();
    this.initialized = false;
    await this.initialize();
  }

  /**
   * Stop all scheduled jobs and clear the scheduler state.
   * Called during application shutdown to clean up cron tasks.
   */
  async shutdown(): Promise<void> {
    const jobCount = this.jobs.size;

    for (const [key, task] of this.jobs.entries()) {
      task.stop();
    }

    this.jobs.clear();
    this.initialized = false;

    logger.info('Sync scheduler shut down', {
      stoppedJobs: jobCount,
    });
  }

  /**
   * Get the list of currently scheduled sync keys.
   */
  getScheduledJobs(): string[] {
    return Array.from(this.jobs.keys());
  }

  /**
   * Check if a sync is already running for a specific store and entity type.
   * Prevents duplicate concurrent syncs from being triggered.
   *
   * @param storeId - The store ID to check.
   * @param entityType - The entity type to check.
   * @returns True if a sync with status 'running' or 'queued' exists.
   */
  private async isSyncRunning(
    storeId: string,
    entityType: EntityType,
  ): Promise<boolean> {
    try {
      const runningJobs = await SyncJobModel.findByStoreId(storeId, {
        entityType,
        status: 'running',
        limit: 1,
      });

      if (runningJobs.data.length > 0) {
        return true;
      }

      const queuedJobs = await SyncJobModel.findByStoreId(storeId, {
        entityType,
        status: 'queued',
        limit: 1,
      });

      return queuedJobs.data.length > 0;
    } catch (error) {
      logger.error('Failed to check if sync is running', {
        storeId,
        entityType,
        error: (error as Error).message,
      });
      // If we can't check, err on the side of allowing the sync
      return false;
    }
  }

  /**
   * Check if a store+entity combination has an existing scheduled sync
   * configuration (based on sync job history).
   *
   * @param storeId - The store ID.
   * @param entityType - The entity type.
   * @returns True if there is an existing scheduled sync record.
   */
  private async hasExistingSchedule(
    storeId: string,
    entityType: EntityType,
  ): Promise<boolean> {
    try {
      const scheduledJobs = await SyncJobModel.findByStoreId(storeId, {
        entityType,
        trigger: 'scheduled',
        limit: 1,
      });
      return scheduledJobs.data.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Build a unique key for the scheduled jobs map.
   *
   * @param storeId - The store ID.
   * @param entityType - The entity type.
   * @returns A string key in the format "storeId:entityType".
   */
  private buildKey(storeId: string, entityType: EntityType): ScheduleKey {
    return `${storeId}:${entityType}`;
  }
}

export default SyncScheduler;
