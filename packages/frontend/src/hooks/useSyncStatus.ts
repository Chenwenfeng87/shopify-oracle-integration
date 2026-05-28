import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi, ApiError } from './useApi';

// ============================================================================
// Types
// ============================================================================

export interface SyncJobSummary {
  id: string;
  storeId: string;
  entityType: string;
  direction: string;
  status: string;
  trigger: string;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  startedAt: string | null;
  completedAt: string | null;
  errorSummary: Record<string, unknown> | null;
  createdAt: string;
}

export interface SyncJobDetail extends SyncJobSummary {
  logs: SyncLogEntry[];
}

export interface SyncLogEntry {
  id: string;
  syncJobId: string;
  recordId: string;
  action: string;
  sourceData: Record<string, unknown> | null;
  targetData: Record<string, unknown> | null;
  conflictDetected: boolean;
  conflictResolution: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface DashboardStats {
  totalSyncsToday: number;
  successRate: number;
  activeStores: number;
  queuedJobs: number;
  recentActivity: ActivityEntry[];
  entityBreakdown: EntityBreakdown[];
}

export interface ActivityEntry {
  id: string;
  entityType: string;
  status: string;
  recordsProcessed: number;
  timestamp: string;
}

export interface EntityBreakdown {
  entityType: string;
  total: number;
  succeeded: number;
  failed: number;
}

export interface ManualSyncRequest {
  entityType: string;
  direction: string;
}

// ============================================================================
// Hook: useSyncStatus
// ============================================================================

/**
 * Hook for polling and managing synchronization status.
 * Provides React Query hooks for all sync-related data needs.
 */
export function useSyncStatus() {
  const { get, post, useGetQuery, usePostMutation } = useApi();
  const queryClient = useQueryClient();

  /**
   * Fetch dashboard statistics.
   */
  const useDashboardStats = () =>
    useGetQuery<DashboardStats>(
      ['sync', 'dashboard'],
      '/sync/dashboard',
      undefined,
      {
        refetchInterval: 30000, // Poll every 30 seconds
      }
    );

  /**
   * Fetch paginated list of sync jobs.
   */
  const useSyncJobs = (params?: {
    page?: number;
    perPage?: number;
    status?: string;
    entityType?: string;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.perPage) searchParams.set('perPage', String(params.perPage));
    if (params?.status) searchParams.set('status', params.status);
    if (params?.entityType) searchParams.set('entityType', params.entityType);

    const queryString = searchParams.toString();
    const url = `/sync/jobs${queryString ? `?${queryString}` : ''}`;

    return useGetQuery<{
      jobs: SyncJobSummary[];
      total: number;
      page: number;
      totalPages: number;
    }>(['sync', 'jobs', params], url, undefined, {
      refetchInterval: 15000,
    });
  };

  /**
   * Fetch a single sync job with its logs.
   */
  const useSyncJobDetail = (jobId: string) =>
    useGetQuery<SyncJobDetail>(
      ['sync', 'job', jobId],
      `/sync/jobs/${jobId}`,
      undefined,
      {
        enabled: !!jobId,
        refetchInterval: 10000, // Poll more frequently for active jobs
      }
    );

  /**
   * Fetch sync logs with filters.
   */
  const useSyncLogs = (params?: {
    jobId?: string;
    entityType?: string;
    action?: string;
    page?: number;
    perPage?: number;
    startDate?: string;
    endDate?: string;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.jobId) searchParams.set('jobId', params.jobId);
    if (params?.entityType) searchParams.set('entityType', params.entityType);
    if (params?.action) searchParams.set('action', params.action);
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.perPage) searchParams.set('perPage', String(params.perPage));
    if (params?.startDate) searchParams.set('startDate', params.startDate);
    if (params?.endDate) searchParams.set('endDate', params.endDate);

    const queryString = searchParams.toString();
    const url = `/sync/logs${queryString ? `?${queryString}` : ''}`;

    return useGetQuery<{
      logs: SyncLogEntry[];
      total: number;
      page: number;
      totalPages: number;
    }>(['sync', 'logs', params], url, undefined, {
      refetchInterval: 15000,
    });
  };

  /**
   * Initiate a manual sync.
   */
  const useTriggerManualSync = () =>
    usePostMutation<SyncJobSummary, ManualSyncRequest>('/sync/trigger', {
      onSuccess: (data) => {
        // Invalidate relevant queries
        queryClient.invalidateQueries({ queryKey: ['sync', 'jobs'] });
        queryClient.invalidateQueries({ queryKey: ['sync', 'dashboard'] });
        return data;
      },
    });

  /**
   * Cancel a running sync job.
   */
  const useCancelSyncJob = () => {
    const { post: postRequest } = useApi();

    return useMutation<void, ApiError, string>({
      mutationFn: async (jobId: string) => {
        await postRequest(`/sync/jobs/${jobId}/cancel`);
      },
      onSuccess: (_data, jobId) => {
        queryClient.invalidateQueries({ queryKey: ['sync', 'job', jobId] });
        queryClient.invalidateQueries({ queryKey: ['sync', 'jobs'] });
      },
    });
  };

  /**
   * Retry a failed sync job.
   */
  const useRetrySyncJob = () => {
    const { post: postRequest } = useApi();

    return useMutation<void, ApiError, string>({
      mutationFn: async (jobId: string) => {
        await postRequest(`/sync/jobs/${jobId}/retry`);
      },
      onSuccess: (_data, jobId) => {
        queryClient.invalidateQueries({ queryKey: ['sync', 'job', jobId] });
        queryClient.invalidateQueries({ queryKey: ['sync', 'jobs'] });
      },
    });
  };

  return {
    useDashboardStats,
    useSyncJobs,
    useSyncJobDetail,
    useSyncLogs,
    useTriggerManualSync,
    useCancelSyncJob,
    useRetrySyncJob,
  };
}
