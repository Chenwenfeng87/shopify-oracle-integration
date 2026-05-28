import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { shopifyAuth } from '../middleware/shopify-auth';
import { syncRateLimit } from '../middleware/rate-limit';
import { SyncJobModel } from '../models/sync-job.model';
import { SyncLogModel } from '../models/sync-log.model';
import { StoreModel } from '../models/store.model';
import { logger } from '../utils/logger';
import type { EntityType, SyncDirection, SyncTrigger } from '@shared/types';

const router = Router();

// All sync routes require authentication
router.use(shopifyAuth);

/**
 * POST /api/sync/start
 * Start a new sync operation for a given entity type and direction.
 */
router.post('/start', syncRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      storeId: z.string().uuid(),
      entityType: z.enum(['item', 'customer', 'order', 'price', 'inventory']),
      direction: z.enum(['shopify_to_oracle', 'oracle_to_shopify']),
      trigger: z.enum(['manual', 'scheduled', 'webhook']).default('manual'),
      totalRecords: z.number().int().min(0).optional(),
    });

    const validated = schema.parse(req.body);
    const { storeId, entityType, direction, trigger, totalRecords } = validated;

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
      entityType: entityType as EntityType,
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

    // Create the sync job
    const syncJob = await SyncJobModel.create({
      storeId,
      entityType: entityType as EntityType,
      direction: direction as SyncDirection,
      trigger: trigger as SyncTrigger,
      totalRecords: totalRecords ?? 0,
    });

    logger.info('Sync job created', {
      jobId: syncJob.id,
      storeId,
      entityType,
      direction,
      trigger,
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
});

/**
 * GET /api/sync/jobs
 * List sync jobs for a store with optional filtering.
 */
router.get('/jobs', async (req: Request, res: Response, next: NextFunction) => {
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
});

/**
 * GET /api/sync/jobs/:jobId
 * Get a specific sync job by ID.
 */
router.get('/jobs/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;

    const syncJob = await SyncJobModel.findById(jobId);
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
    next(error);
  }
});

/**
 * GET /api/sync/jobs/:jobId/logs
 * Get sync logs for a specific job.
 */
router.get('/jobs/:jobId/logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;

    const schema = z.object({
      action: z.enum(['created', 'updated', 'skipped', 'failed']).optional(),
      conflictDetected: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
      sortOrder: z.enum(['asc', 'desc']).optional(),
    });

    const validated = schema.parse(req.query);

    // Verify job exists
    const syncJob = await SyncJobModel.findById(jobId);
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

    const result = await SyncLogModel.findByJobId(jobId, validated);

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
});

/**
 * POST /api/sync/jobs/:jobId/cancel
 * Cancel a pending or running sync job.
 */
router.post('/jobs/:jobId/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jobId } = req.params;

    const syncJob = await SyncJobModel.findById(jobId);
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

    if (syncJob.status !== 'pending' && syncJob.status !== 'queued' && syncJob.status !== 'running') {
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

    await SyncJobModel.cancel(jobId);

    logger.info('Sync job cancelled', { jobId, storeId: syncJob.storeId });

    res.json({
      success: true,
      data: { message: 'Sync job cancelled successfully' },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sync/errors
 * Retrieve recent sync errors for a store.
 */
router.get('/errors', async (req: Request, res: Response, next: NextFunction) => {
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
});

export default router;
