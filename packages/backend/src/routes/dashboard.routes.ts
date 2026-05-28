import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { shopifyAuth } from '../middleware/shopify-auth';
import { query } from '../config/database';
import { StoreModel } from '../models/store.model';
import { CredentialModel } from '../models/credential.model';
import { SyncLogModel } from '../models/sync-log.model';
import { logger } from '../utils/logger';

const router = Router();

// All dashboard routes require authentication
router.use(shopifyAuth);

/**
 * GET /api/dashboard/summary
 * Get a summary of sync activity for a store's dashboard.
 * Returns totals, recent job counts, error counts, and system status.
 */
router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      storeId: z.string().uuid(),
    });

    const validated = schema.parse(req.query);
    const { storeId } = validated;

    // Verify store exists
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

    // Fetch dashboard data in parallel
    const [
      syncJobCounts,
      recentJobs,
      entityCounts,
      recentErrors,
      credentials,
    ] = await Promise.all([
      // Sync job status counts
      query<{ status: string; count: number }>(
        `SELECT status, COUNT(*) as count
         FROM sync_jobs
         WHERE store_id = $1
         GROUP BY status`,
        [storeId],
      ),

      // Recent sync jobs (last 10)
      query(
        `SELECT id, entity_type, direction, status, trigger, total_records, processed_records, failed_records, created_at, completed_at
         FROM sync_jobs
         WHERE store_id = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [storeId],
      ),

      // Sync job counts by entity type
      query<{ entity_type: string; count: number }>(
        `SELECT entity_type, COUNT(*) as count
         FROM sync_jobs
         WHERE store_id = $1
         GROUP BY entity_type`,
        [storeId],
      ),

      // Recent errors
      SyncLogModel.findErrors(storeId, 20),

      // Oracle credentials status
      CredentialModel.findByStoreId(storeId),
    ]);

    // Compute totals from status counts
    const statusCounts: Record<string, number> = {};
    let totalSyncJobs = 0;
    for (const row of syncJobCounts.rows) {
      statusCounts[row.status] = parseInt(row.count as unknown as string, 10);
      totalSyncJobs += statusCounts[row.status];
    }

    // Compute entity type distribution
    const entityDistribution: Record<string, number> = {};
    for (const row of entityCounts.rows) {
      entityDistribution[row.entity_type] = parseInt(row.count as unknown as string, 10);
    }

    // Get running job count
    const runningJobs = statusCounts['running'] || 0;

    res.json({
      success: true,
      data: {
        overview: {
          totalSyncJobs,
          runningJobs,
          completedJobs: statusCounts['completed'] || 0,
          failedJobs: statusCounts['failed'] || 0,
          pendingJobs: statusCounts['pending'] || 0,
          queuedJobs: statusCounts['queued'] || 0,
          partialJobs: statusCounts['partial'] || 0,
        },
        entityDistribution,
        recentJobs: recentJobs.rows,
        recentErrors,
        credentials: credentials
          ? {
              configured: true,
              isValid: credentials.isValid,
              environment: credentials.environment,
              baseUrl: credentials.baseUrl,
              lastTestedAt: credentials.lastTestedAt,
            }
          : { configured: false },
        store: {
          id: store.id,
          shopifyDomain: store.shopifyDomain,
          isActive: store.isActive,
          installedAt: store.installedAt,
        },
      },
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

/**
 * GET /api/dashboard/activity
 * Get recent sync activity for the dashboard timeline.
 */
router.get('/activity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      storeId: z.string().uuid(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    });

    const validated = schema.parse(req.query);
    const { storeId, limit } = validated;

    const result = await query(
      `SELECT sj.id, sj.entity_type, sj.direction, sj.status, sj.trigger,
              sj.total_records, sj.processed_records, sj.failed_records,
              sj.created_at, sj.completed_at,
              COUNT(sl.id) as log_count
       FROM sync_jobs sj
       LEFT JOIN sync_logs sl ON sl.sync_job_id = sj.id
       WHERE sj.store_id = $1
       GROUP BY sj.id
       ORDER BY sj.created_at DESC
       LIMIT $2`,
      [storeId, limit],
    );

    res.json({
      success: true,
      data: result.rows,
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

/**
 * GET /api/dashboard/stats
 * Get sync statistics over time for charts.
 * Returns daily sync counts for the last N days.
 */
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      storeId: z.string().uuid(),
      days: z.coerce.number().int().min(1).max(90).default(30),
    });

    const validated = schema.parse(req.query);
    const { storeId, days } = validated;

    const result = await query(
      `SELECT
         DATE(created_at) as day,
         COUNT(*) as total_jobs,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_jobs,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_jobs,
         SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partial_jobs,
         SUM(processed_records) as total_processed,
         SUM(failed_records) as total_failed
       FROM sync_jobs
       WHERE store_id = $1
         AND created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY DATE(created_at)
       ORDER BY day DESC`,
      [storeId, days],
    );

    res.json({
      success: true,
      data: result.rows,
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
