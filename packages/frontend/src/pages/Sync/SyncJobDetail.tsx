import React, { useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Page,
  Layout,
  Card,
  DataTable,
  Button,
  Banner,
  Spinner,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  EmptyState,
  SkeletonPage,
  SkeletonBodyText,
  Tabs,
  Pagination,
  Box,
  Tooltip,
} from '@shopify/polaris';
import { useSyncStatus, SyncLogEntry } from '../../hooks/useSyncStatus';
import { SyncStatusBadge, SyncStatus } from '../../components/SyncStatusBadge/SyncStatusBadge';

const LOGS_PER_PAGE = 50;

/**
 * Sync Job Detail page.
 * Shows detailed information about a single sync job,
 * including all per-record log entries.
 */
export function SyncJobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { useSyncJobDetail, useSyncLogs, useCancelSyncJob, useRetrySyncJob } = useSyncStatus();

  const [selectedTab, setSelectedTab] = useState(0);
  const [logPage, setLogPage] = useState(1);

  const { data: job, isLoading, error, refetch } = useSyncJobDetail(jobId || '');
  const { data: logsData, isLoading: logsLoading } = useSyncLogs({
    jobId,
    page: logPage,
    perPage: LOGS_PER_PAGE,
  });

  const cancelMutation = useCancelSyncJob();
  const retryMutation = useRetrySyncJob();

  const handleCancel = useCallback(async () => {
    if (jobId) {
      await cancelMutation.mutateAsync(jobId);
    }
  }, [jobId, cancelMutation]);

  const handleRetry = useCallback(async () => {
    if (jobId) {
      await retryMutation.mutateAsync(jobId);
    }
  }, [jobId, retryMutation]);

  const handleBack = useCallback(() => {
    navigate('/sync/overview');
  }, [navigate]);

  const handlePreviousPage = useCallback(() => {
    setLogPage((p) => Math.max(1, p - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    setLogPage((p) => p + 1);
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <SkeletonPage title="Sync Job Details" backAction={{ content: 'Back', onAction: handleBack }}>
        <Layout>
          <Layout.Section>
            <SkeletonBodyText lines={8} />
          </Layout.Section>
        </Layout>
      </SkeletonPage>
    );
  }

  // Error state
  if (error || !job) {
    return (
      <Page
        title="Sync Job Details"
        backAction={{ content: 'Sync Overview', onAction: handleBack }}
      >
        <Banner status="critical" title="Failed to load job details">
          <p>Unable to load the sync job. It may have been deleted or you may not have access.</p>
          <Button onClick={() => refetch()}>Retry</Button>
        </Banner>
      </Page>
    );
  }

  const isActive = job.status === 'running' || job.status === 'queued' || job.status === 'pending';

  const tabs = [
    { id: 'overview', content: 'Overview', panelID: 'overview-panel' },
    { id: 'logs', content: `Logs (${job.logs?.length || 0})`, panelID: 'logs-panel' },
    { id: 'errors', content: `Errors (${job.failedRecords})`, panelID: 'errors-panel' },
  ];

  // Error log entries
  const errorLogs = (job.logs || []).filter((log) => log.action === 'failed');

  // Build log rows
  const logs = logsData?.logs || job.logs || [];
  const logRows = logs.map((log: SyncLogEntry) => [
    new Date(log.createdAt).toLocaleString(),
    log.recordId,
    <SyncStatusBadge key={`a-${log.id}`} status={log.action as SyncStatus} />,
    log.conflictDetected ? (
      <Badge key={`c-${log.id}`} status="warning">
        Yes
      </Badge>
    ) : (
      'No'
    ),
    log.errorMessage ? (
      <Tooltip content={log.errorMessage} key={`t-${log.id}`}>
        <span style={{ maxWidth: '200px', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {log.errorMessage}
        </span>
      </Tooltip>
    ) : (
      '-'
    ),
  ]);

  const tabsMarkup = (
    <>
      {selectedTab === 0 && (
        <Box padding="400">
          <BlockStack gap="400">
            <InlineStack gap="400" wrap={false}>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">Status</Text>
                <SyncStatusBadge status={job.status as SyncStatus} />
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">Entity</Text>
                <Text as="span" fontWeight="bold">{job.entityType}</Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">Direction</Text>
                <Text as="span" fontWeight="bold">
                  {job.direction === 'shopify_to_oracle' ? 'Shopify to Oracle' : 'Oracle to Shopify'}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">Trigger</Text>
                <Text as="span" fontWeight="bold">{job.trigger}</Text>
              </BlockStack>
            </InlineStack>

            <InlineStack gap="400" wrap={false}>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">Progress</Text>
                <Text as="span" fontWeight="bold">
                  {job.processedRecords} / {job.totalRecords}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">Failed</Text>
                <Text as="span" fontWeight="bold" tone={job.failedRecords > 0 ? 'critical' : undefined}>
                  {job.failedRecords}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">Started</Text>
                <Text as="span" fontWeight="bold">
                  {job.startedAt ? new Date(job.startedAt).toLocaleString() : 'Not started'}
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="span" variant="bodySm" tone="subdued">Completed</Text>
                <Text as="span" fontWeight="bold">
                  {job.completedAt ? new Date(job.completedAt).toLocaleString() : '-'}
                </Text>
              </BlockStack>
            </InlineStack>

            {job.errorSummary && (
              <Banner status="warning" title="Error Summary">
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '12px' }}>
                  {JSON.stringify(job.errorSummary, null, 2)}
                </pre>
              </Banner>
            )}
          </BlockStack>
        </Box>
      )}

      {selectedTab === 1 && (
        <Box padding="400">
          {logRows.length > 0 ? (
            <BlockStack gap="300">
              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                headings={['Time', 'Record', 'Action', 'Conflict', 'Error']}
                rows={logRows}
                defaultSortDirection="descending"
                initialSortColumnIndex={0}
              />
              {logsData && logsData.totalPages > 1 && (
                <InlineStack align="center">
                  <Pagination
                    label={`Page ${logPage} of ${logsData.totalPages}`}
                    hasPrevious={logPage > 1}
                    onPrevious={handlePreviousPage}
                    hasNext={logPage < logsData.totalPages}
                    onNext={handleNextPage}
                  />
                </InlineStack>
              )}
            </BlockStack>
          ) : (
            <EmptyState heading="No log entries" image="">
              <p>No log entries have been recorded for this job.</p>
            </EmptyState>
          )}
        </Box>
      )}

      {selectedTab === 2 && (
        <Box padding="400">
          {errorLogs.length > 0 ? (
            <BlockStack gap="200">
              {errorLogs.map((log) => (
                <Card key={log.id}>
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center">
                      <Badge status="critical">Failed</Badge>
                      <Text as="span" variant="bodySm" fontWeight="bold">
                        Record: {log.recordId}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {new Date(log.createdAt).toLocaleString()}
                      </Text>
                    </InlineStack>
                    {log.errorMessage && (
                      <Box
                        padding="200"
                        borderRadius="100"
                        background="bg-surface-critical"
                      >
                        <Text as="p" variant="bodySm" tone="critical">
                          {log.errorMessage}
                        </Text>
                      </Box>
                    )}
                  </BlockStack>
                </Card>
              ))}
            </BlockStack>
          ) : (
            <EmptyState heading="No errors" image="">
              <p>This job completed without errors.</p>
            </EmptyState>
          )}
        </Box>
      )}
    </>
  );

  return (
    <Page
      title={`Sync Job: ${job.entityType}`}
      subtitle={`Job ID: ${job.id}`}
      backAction={{ content: 'Sync Overview', onAction: handleBack }}
      primaryAction={
        isActive
          ? {
              content: 'Cancel',
              onAction: handleCancel,
              loading: cancelMutation.isPending,
              tone: 'critical',
            }
          : (job.status === 'failed' || job.status === 'partial')
          ? {
              content: 'Retry',
              onAction: handleRetry,
              loading: retryMutation.isPending,
            }
          : undefined
      }
    >
      <Layout>
        <Layout.Section>
          <Card>
            <Tabs
              tabs={tabs}
              selected={selectedTab}
              onSelect={setSelectedTab}
            />
            {tabsMarkup}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
