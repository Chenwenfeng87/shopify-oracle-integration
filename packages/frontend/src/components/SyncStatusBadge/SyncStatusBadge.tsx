import React from 'react';
import { Badge } from '@shopify/polaris';

export type SyncStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'partial';
export type LogAction = 'created' | 'updated' | 'skipped' | 'failed';

export interface SyncStatusBadgeProps {
  status: SyncStatus | LogAction;
  size?: 'small' | 'medium' | 'large';
}

const STATUS_CONFIG: Record<string, { status: 'success' | 'warning' | 'critical' | 'info' | 'attention' | 'new'; progress: 'complete' | 'partiallyComplete' | 'incomplete' | undefined; label: string }> = {
  completed: { status: 'success', progress: 'complete', label: 'Completed' },
  success: { status: 'success', progress: 'complete', label: 'Success' },
  running: { status: 'attention', progress: 'partiallyComplete', label: 'Running' },
  queued: { status: 'info', progress: 'incomplete', label: 'Queued' },
  pending: { status: 'info', progress: 'incomplete', label: 'Pending' },
  partial: { status: 'warning', progress: 'partiallyComplete', label: 'Partial' },
  failed: { status: 'critical', progress: 'incomplete', label: 'Failed' },
  created: { status: 'success', progress: 'complete', label: 'Created' },
  updated: { status: 'info', progress: 'complete', label: 'Updated' },
  skipped: { status: 'warning', progress: 'incomplete', label: 'Skipped' },
};

/**
 * Badge component that displays a sync status with appropriate coloring.
 *
 * Color scheme:
 * - Green (success): completed, created, success
 * - Yellow (warning): partial, skipped
 * - Red (critical): failed
 * - Blue (info): pending, queued, updated
 * - Orange (attention): running
 */
export function SyncStatusBadge({ status, size = 'medium' }: SyncStatusBadgeProps) {
  const config = STATUS_CONFIG[status] || {
    status: 'info' as const,
    progress: undefined,
    label: status.charAt(0).toUpperCase() + status.slice(1),
  };

  return (
    <Badge status={config.status} progress={config.progress} size={size}>
      {config.label}
    </Badge>
  );
}
