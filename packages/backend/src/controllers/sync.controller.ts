import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SyncJobModel } from '../models/sync-job.model';
import { SyncLogModel } from '../models/sync-log.model';
import { StoreModel } from '../models/store.model';
import { SyncEngine } from '../services/sync/sync-engine';
import { logger } from '../utils/logger';
import type { EntityType, SyncDirection, SyncTrigger, SyncStatus } from '@shared/types';

/**
 * Handles all sync-related HTTP requests:
 *
 * - POST  /api/sync/:entityType   — Trigger a new manual sync
 * - GET   /api/sync/jobs           — List sync jobs with filters
 * - GET   /api/sync/jobs/:id       — Get a single sync job detail
 * - GET   /api/sync/jobs/:id/logs  — Get logs for a sync job
 * - POST  /api/sync/jobs/:id/cancel — Cancel a running sync job
 * - GET   /api/sync/status         — Get current sync status
 * - GET   /api/sync/errors         — Get recent sync errors
 */
export class SyncController {
  /**
   * POST /api/sync/:entityType
   *
   * Trigger a manual synchronization for a specific entity type.
   * Validates parameters, checks for duplicate running syncs, creates a
   * sync job, and starts the async sync engine.
   */
  async triggerSync(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const paramsSchema = z.object({
        entityType: z.enum(['item', 'customer', 'order', 'price', 'inventory']),
      });

      const bodySchema = z.object({
        storeId: z.string().uuid(),
        direction: z
          .enum(['shopify_to_oracle', 'oracle_to_shopify'])
          .optional(),
        trigger: z.enum(['manual', 'scheduled', 'webhook']).default('manual'),
        batchSize: z.number().int().min(1).max(500).optional(),
        params: z.record(z.unknown()).optional(),
      });

      const params = paramsSchema.parse(req.params);
      const body = bodySchema.parse(req.body);

      const entityType = params.entityType as EntityType;
      const storeId = body.storeId;
      const direction = (body.direction || this.getDefaultDirection(entityType)) as SyncDirection;
      const trigger = body.trigger as SyncTrigger;

      // Verify store exists and is active
      const store = await StoreModel.findById(storeId);
      if (!store) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Store not found',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      if (!store.isActive) {
        res.status(400).json({
          success: false,
          error: {
            code: 'STORE_INACTIVE',
            message: 'Store is inactive. Please re-install the app.',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      // Check for existing running sync jobs for the same store+entity
      const existingJobs = await SyncJobModel.findByStoreId(storeId, {
        entityType,
        status: 'running',
        limit: 1,
      });

      if (existingJobs.data.length > 0) {
        res.status(409).json({
          success: false,
          error: {
            code: 'SYNC_IN_PROGRESS',
            message: `A sync for ${entityType} is already running. Wait for it to complete before starting a new one.`,
            details: { existingJobId: existingJobs.data[0].id },
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      // Start the sync via the engine
      const syncEngine = new SyncEngine(storeId);
      const syncJob = await syncEngine.startSync(entityType, direction, trigger, {
        params: body.params,
        batchSize: body.batchSize,
      });

      logger.info('Manual sync triggered', {
        jobId: syncJob.id,
        storeId,
        entityType,
        direction,
        requestId: req.requestId,
      });

      res.status(201).json({
        success: true,
        data: syncJob,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid sync request parameters',
            details: error.errors.map((e) => ({
              path: e.path.join('.'),
              message: e.message,
            })),
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
      next(error);
    }
  }

  /**
   * GET /api/sync/jobs
   *
   * List sync jobs with optional filtering by entity type, status, trigger,
   * direction, and date range.
   */
  async listJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        storeId: z.string().uuid(),
        status: z.enum(['pending', 'queued', 'running', 'completed', 'failed', 'partial']).optional(),
        entityType: z.enum(['item', 'customer', 'order', 'price', 'inventory']).optional(),
        direction: z.enum(['shopify_to_oracle', 'oracle_to_shopify']).optional(),
        trigger: z.enum(['manual', 'scheduled', 'webhook']).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
        sortBy: z.string().optional(),
        sortOrder: z.enum(['asc', 'desc']).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      });

      const validated = schema.parse(req.query);
      const { storeId, ...filters } = validated;

      const result = await SyncJobModel.findByStoreId(storeId, filters);

      logger.debug('Sync jobs listed', {
        storeId,
        filters: Object.keys(filters),
        total: result.pagination.total,
        requestId: req.requestId,
      });

      res.json({
        success: true,
        data: result.data,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
          pagination: result.pagination,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: error.errors.map((e) => ({
              path: e.path.join('.'),
              message: e.message,
            })),
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
      next(error);
    }
  }

  /**
   * GET /api/sync/jobs/:id
   *
   * Get details for a single sync job by its ID.
   */
  async getJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        id: z.string().uuid(),
      });

      const validated = schema.parse(req.params);
      const syncJob = await SyncJobModel.findById(validated.id);

      if (!syncJob) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Sync job not found',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      res.json({
        success: true,
        data: syncJob,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid job ID',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
      next(error);
    }
  }

  /**
   * GET /api/sync/jobs/:id/logs
   *
   * Get the sync logs for a specific job, with optional filtering by action,
   * conflict detection, and pagination.
   */
  async getJobLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const paramsSchema = z.object({
        id: z.string().uuid(),
      });

      const querySchema = z.object({
        action: z.enum(['created', 'updated', 'skipped', 'failed']).optional(),
        conflictDetected: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        sortOrder: z.enum(['asc', 'desc']).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      });

      const params = paramsSchema.parse(req.params);
      const query = querySchema.parse(req.query);

      // Verify job exists
      const syncJob = await SyncJobModel.findById(params.id);
      if (!syncJob) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Sync job not found',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      const result = await SyncLogModel.findByJobId(params.id, query);

      res.json({
        success: true,
        data: result.data,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
          pagination: result.pagination,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request parameters',
            details: error.errors.map((e) => ({
              path: e.path.join('.'),
              message: e.message,
            })),
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
      next(error);
    }
  }

  /**
   * POST /api/sync/jobs/:id/cancel
   *
   * Cancel a pending, queued, or running sync job.
   */
  async cancelJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        id: z.string().uuid(),
      });

      const validated = schema.parse(req.params);

      const syncJob = await SyncJobModel.findById(validated.id);
      if (!syncJob) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Sync job not found',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      if (
        syncJob.status !== 'pending' &&
        syncJob.status !== 'queued' &&
        syncJob.status !== 'running'
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_STATE',
            message: `Cannot cancel job with status: ${syncJob.status}`,
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      // Cancel via SyncEngine (sets cancellation token and updates DB)
      const syncEngine = new SyncEngine(syncJob.storeId);
      await syncEngine.cancelSync(validated.id);

      logger.info('Sync job cancelled', {
        jobId: validated.id,
        storeId: syncJob.storeId,
        requestId: req.requestId,
      });

      res.json({
        success: true,
        data: { message: 'Sync job cancelled successfully' },
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid job ID',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
      next(error);
    }
  }

  /**
   * GET /api/sync/status
   *
   * Get the current sync status for a store, including last sync timestamps,
   * active/queued job counts, and today's failure count.
   */
  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        storeId: z.string().uuid(),
      });

      const validated = schema.parse(req.query);

      // Verify store exists
      const store = await StoreModel.findById(validated.storeId);
      if (!store) {
        res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Store not found',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }

      const syncEngine = new SyncEngine(validated.storeId);
      const status = await syncEngine.getSyncStatus();

      res.json({
        success: true,
        data: status,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
      next(error);
    }
  }

  /**
   * GET /api/sync/errors
   *
   * Get recent sync errors for a store.
   */
  async getErrors(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schema = z.object({
        storeId: z.string().uuid(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      });

      const validated = schema.parse(req.query);
      const { storeId, limit } = validated;

      const errors = await SyncLogModel.findErrors(storeId, limit);

      res.json({
        success: true,
        data: errors,
        meta: {
          timestamp: new Date().toISOString(),
          requestId: req.requestId,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
          },
        });
        return;
      }
      next(error);
    }
  }

  /**
   * Get the default sync direction for a given entity type.
   * Items, customers, and orders typically flow Shopify -> Oracle.
   * Prices and inventory typically flow Oracle -> Shopify.
   */
  private getDefaultDirection(entityType: EntityType): SyncDirection {
    const defaultDirections: Record<EntityType, SyncDirection> = {
      item: 'shopify_to_oracle',
      customer: 'shopify_to_oracle',
      order: 'shopify_to_oracle',
      price: 'oracle_to_shopify',
      inventory: 'oracle_to_shopify',
    };
    return defaultDirections[entityType];
  }
}

export default SyncController;
