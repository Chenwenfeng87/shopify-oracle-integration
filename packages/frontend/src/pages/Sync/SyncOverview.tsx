import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Select,
  Badge,
  EmptyState,
  Pagination,
  SkeletonPage,
  SkeletonBodyText,
  Tabs,
} from '@shopify/polaris';
import { useSyncStatus, SyncJobSummary } from '../../hooks/useSyncStatus';
import { SyncStatusBadge, SyncStatus } from '../../components/SyncStatusBadge/SyncStatusBadge';

const ENTITY_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Items', value: 'item' },
  { label: 'Customers', value: 'customer' },
  { label: 'Orders', value: 'order' },
  { label: 'Prices', value: 'price' },
  { label: 'Inventory', value: 'inventory' },
];

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Running', value: 'running' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Pending', value: 'pending' },
  { label: 'Partial', value: 'partial' },
];

const PER_PAGE = 20;

/**
 * Sync Overview page displaying a paginated list of all sync jobs.
 */
export function SyncOverview() {
  const navigate = useNavigate();
  const { useSyncJobs, useRetrySyncJob } = useSyncStatus();

  const [page, setPage] = useState(1);
  const [entityFilter, setEntityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading, error, refetch } = useSyncJobs({
    page,
    perPage: PER_PAGE,
    status: statusFilter || undefined,
    entityType: entityFilter || undefined,
  });

  const retryMutation = useRetrySyncJob();

  const handleViewJob = useCallback(
    (jobId: string) => {
      navigate(`/sync/jobs/${jobId}`);
    },
    [navigate]
  );

  const handleRetryJob = useCallback(
    async (e: React.MouseEvent, jobId: string) => {
      e.stopPropagation();
      await retryMutation.mutateAsync(jobId);
    },
    [retryMutation]
  );

  const handlePreviousPage = useCallback(() => {
    setPage((p) => Math.max(1, p - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  // Build table rows
  const jobs = data?.jobs || [];
  const totalPages = data?.totalPages || 1;

  const rows = jobs.map((job: SyncJobSummary) => [
    new Date(job.createdAt).toLocaleString(),
    job.entityType,
    <SyncStatusBadge key={`s-${job.id}`} status={job.status as SyncStatus} />,
    job.direction === 'shopify_to_oracle' ? 'Shopify to Oracle' : 'Oracle to Shopify',
    job.trigger,
    `${job.processedRecords} / ${job.totalRecords}`,
    job.failedRecords > 0 ? (
      <Badge key={`f-${job.id}`} status="critical">
        {job.failedRecords}
      </Badge>
    ) : (
      '0'
    ),
    <InlineStack key={`a-${job.id}`} gap="200">
      <Button variant="plain" onClick={() => handleViewJob(job.id)}>
        View
      </Button>
      {(job.status === 'failed' || job.status === 'partial') && (
        <Button
          variant="plain"
          tone="critical"
          onClick={(e) => handleRetryJob(e, job.id)}
          loading={retryMutation.isPending}
        >
          Retry
        </Button>
      )}
    </InlineStack>,
  ]);

  // Loading state
  if (isLoading && !data) {
    return (
      <SkeletonPage title="Sync Overview">
        <Layout>
          <Layout.Section>
            <SkeletonBodyText lines={10} />
          </Layout.Section>
        </Layout>
      </SkeletonPage>
    );
  }

  // Error state
  if (error) {
    return (
      <Page title="Sync Overview">
        <Banner status="critical" title="Failed to load sync jobs">
          <p>Unable to load synchronization jobs. Please try again.</p>
          <Button onClick={() => refetch()}>Retry</Button>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title="Sync Overview"
      subtitle="View and manage all synchronization jobs"
      primaryAction={{
        content: 'Manual Sync',
        onAction: () => navigate('/sync/manual'),
      }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              {/* Filters */}
              <InlineStack gap="300" wrap={false}>
                <div style={{ flex: 1 }}>
                  <Select
                    label="Entity"
                    options={ENTITY_FILTERS}
                    value={entityFilter}
                    onChange={(value) => {
                      setEntityFilter(value);
                      setPage(1);
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Select
                    label="Status"
                    options={STATUS_FILTERS}
                    value={statusFilter}
                    onChange={(value) => {
                      setStatusFilter(value);
                      setPage(1);
                    }}
                  />
                </div>
              </InlineStack>

              {/* Jobs Table */}
              {rows.length > 0 ? (
                <DataTable
                  columnContentTypes={[
                    'text',
                    'text',
                    'text',
                    'text',
                    'text',
                    'numeric',
                    'numeric',
                    'text',
                  ]}
                  headings={[
                    'Date',
                    'Entity',
                    'Status',
                    'Direction',
                    'Trigger',
                    'Progress',
                    'Failed',
                    'Actions',
                  ]}
                  rows={rows}
                  defaultSortDirection="descending"
                  initialSortColumnIndex={0}
                />
              ) : (
                <Box padding="400">
                  <EmptyState heading="No sync jobs found" image="">
                    <p>
                      {entityFilter || statusFilter
                        ? 'No jobs match the selected filters. Try changing the filter criteria.'
                        : 'No sync jobs have been executed yet. Trigger a manual sync to get started.'}
                    </p>
                  </EmptyState>
                </Box>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <InlineStack align="center">
                  <Pagination
                    label={`Page ${page} of ${totalPages}`}
                    hasPrevious={page > 1}
                    onPrevious={handlePreviousPage}
                    hasNext={page < totalPages}
                    onNext={handleNextPage}
                  />
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
