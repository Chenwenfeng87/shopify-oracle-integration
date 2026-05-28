import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { StoreModel } from '../models/store.model';
import { CredentialModel } from '../models/credential.model';
import { SyncLogModel } from '../models/sync-log.model';
import { logger } from '../utils/logger';

/**
 * Handles all dashboard-related HTTP requests:
 *
 * - GET /api/dashboard/summary  — High-level dashboard summary
 * - GET /api/dashboard/activity — Recent sync activity timeline
 * - GET /api/dashboard/stats    — Daily time-series statistics for charts
 */
export class DashboardController {
  /**
   * GET /api/dashboard/summary
   *
   * Returns a comprehensive summary for the dashboard, including:
   * - Total sync jobs and status breakdown
   * - Entity type distribution
   * - Recent job list
   * - Recent errors
   * - Oracle credential status
   * - Store details
   */
  async getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
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

      // Fetch all dashboard data in parallel
      const [syncJobCounts, recentJobsResult, entityCounts, recentErrors, credentials] =
        await Promise.all([
          // Sync job status counts
          query<{ status: string; count: number }>(
            `SELECT status, COUNT(*)::int as count
             FROM sync_jobs
             WHERE store_id = $1
             GROUP BY status`,
            [storeId],
          ),

          // Recent sync jobs (last 10)
          query(
            `SELECT id, entity_type, direction, status, trigger,
                    total_records, processed_records, failed_records,
                    created_at, completed_at
             FROM sync_jobs
             WHERE store_id = $1
             ORDER BY created_at DESC
             LIMIT 10`,
            [storeId],
          ),

          // Entity type distribution
          query<{ entity_type: string; count: number }>(
            `SELECT entity_type, COUNT(*)::int as count
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
        statusCounts[row.status] = row.count;
        totalSyncJobs += row.count;
      }

      // Compute entity distribution
      const entityDistribution: Record<string, number> = {};
      for (const row of entityCounts.rows) {
        entityDistribution[row.entity_type] = row.count;
      }

      // Calculate success rate
      const completedJobs = statusCounts['completed'] || 0;
      const successRate = totalSyncJobs > 0 ? (completedJobs / totalSyncJobs) * 100 : 0;

      const summary = {
        overview: {
          totalSyncs: totalSyncJobs,
          successRate: Math.round(successRate * 100) / 100,
          activeStores: 1,
          queuedJobs: statusCounts['queued'] || 0,
          runningJobs: statusCounts['running'] || 0,
          failedJobs: statusCounts['failed'] || 0,
          completedJobs,
          partialJobs: statusCounts['partial'] || 0,
          pendingJobs: statusCounts['pending'] || 0,
        },
        entityBreakdown: entityDistribution,
        recentJobs: recentJobsResult.rows,
        errorCount: recentErrors.length,
        credentialStatus: credentials
          ? {
              configured: true,
              isValid: credentials.isValid,
              environment: credentials.environment,
              baseUrl: credentials.baseUrl,
              lastTestedAt: credentials.lastTestedAt,
            }
          : { configured: false },
      };

      logger.debug('Dashboard summary retrieved', {
        storeId,
        totalSyncs: totalSyncJobs,
        requestId: req.requestId,
      });

      res.json({
        success: true,
        data: summary,
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
   * GET /api/dashboard/activity
   *
   * Returns recent sync activity for the dashboard timeline.
   * Each activity entry includes the sync job details and the count of
   * associated log entries.
   */
  async getActivity(req: Request, res: Response, next: NextFunction): Promise<void> {
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
                COUNT(sl.id)::int as log_count
         FROM sync_jobs sj
         LEFT JOIN sync_logs sl ON sl.sync_job_id = sj.id
         WHERE sj.store_id = $1
         GROUP BY sj.id
         ORDER BY sj.created_at DESC
         LIMIT $2`,
        [storeId, limit],
      );

      logger.debug('Dashboard activity retrieved', {
        storeId,
        count: result.rows.length,
        requestId: req.requestId,
      });

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
  }

  /**
   * GET /api/dashboard/stats
   *
   * Returns daily time-series sync statistics for charts.
   * Aggregates sync jobs by day for the specified number of trailing days.
   */
  async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
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
           COUNT(*)::int as total_jobs,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::int as completed_jobs,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::int as failed_jobs,
           SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END)::int as partial_jobs,
           COALESCE(SUM(processed_records), 0)::int as total_processed,
           COALESCE(SUM(failed_records), 0)::int as total_failed
         FROM sync_jobs
         WHERE store_id = $1
           AND created_at >= NOW() - INTERVAL '1 day' * $2
         GROUP BY DATE(created_at)
         ORDER BY day DESC`,
        [storeId, days],
      );

      logger.debug('Dashboard stats retrieved', {
        storeId,
        days,
        dataPoints: result.rows.length,
        requestId: req.requestId,
      });

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
  }
}

export default DashboardController;
