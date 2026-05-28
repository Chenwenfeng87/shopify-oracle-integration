import React, { useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  ButtonGroup,
  Banner,
  Spinner,
  SkeletonPage,
  SkeletonBodyText,
  DataTable,
  Badge,
  EmptyState,
  Box,
  Grid,
  Icon,
  List,
} from '@shopify/polaris';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { SyncStatusBadge, SyncStatus } from '../../components/SyncStatusBadge/SyncStatusBadge';
import { AppContext } from '../../App';
import {
  HomeIcon,
  RefreshIcon,
  ViewListIcon,
  ArrowRightIcon,
} from '@shopify/polaris-icons';

/**
 * Dashboard page displaying sync overview with summary cards,
 * recent activity, and quick action buttons.
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const { showToast } = useContext(AppContext);
  const { useDashboardStats, useSyncJobs, useTriggerManualSync } = useSyncStatus();

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useDashboardStats();

  const { data: recentJobsData, isLoading: jobsLoading } = useSyncJobs({
    page: 1,
    perPage: 10,
  });

  const triggerSyncMutation = useTriggerManualSync();

  const handleManualSync = useCallback(
    async (entityType: string) => {
      try {
        await triggerSyncMutation.mutateAsync({
          entityType,
          direction: 'shopify_to_oracle',
        });
        showToast(`${entityType} sync triggered successfully`, {});
      } catch {
        // Error is handled by useApi toast
      }
    },
    [triggerSyncMutation, showToast]
  );

  const handleViewAllSyncs = useCallback(() => {
    navigate('/sync/overview');
  }, [navigate]);

  // Loading state
  if (statsLoading || jobsLoading) {
    return (
      <SkeletonPage title="Dashboard" primaryAction>
        <Layout>
          <Layout.Section>
            <SkeletonBodyText lines={4} />
          </Layout.Section>
          <Layout.Section>
            <SkeletonBodyText lines={6} />
          </Layout.Section>
        </Layout>
      </SkeletonPage>
    );
  }

  // Error state
  if (statsError) {
    return (
      <Page title="Dashboard">
        <Banner status="critical" title="Failed to load dashboard data">
          <p>Unable to load dashboard statistics. Please try again.</p>
          <Button onClick={() => refetchStats()}>Retry</Button>
        </Banner>
      </Page>
    );
  }

  // Empty state (no data at all)
  if (!stats && (!recentJobsData || recentJobsData.jobs.length === 0)) {
    return (
      <Page title="Dashboard">
        <EmptyState
          heading="Welcome to Shopify-Oracle Integration"
          action={{ content: 'Get Started', onAction: () => navigate('/configuration/credentials') }}
          secondaryAction={{ content: 'View Documentation', url: '#' }}
          image=""
        >
          <p>
            Configure your Oracle credentials and field mappings to start synchronizing
            your Shopify data with Oracle Netsuite.
          </p>
        </EmptyState>
      </Page>
    );
  }

  // Data state
  const summaryCards = [
    {
      title: 'Syncs Today',
      value: String(stats?.totalSyncsToday ?? 0),
      description: 'Total sync jobs executed',
    },
    {
      title: 'Success Rate',
      value: stats ? `${(stats.successRate * 100).toFixed(1)}%` : '0%',
      description: 'Jobs completed without errors',
    },
    {
      title: 'Active Stores',
      value: String(stats?.activeStores ?? 0),
      description: 'Connected Shopify stores',
    },
    {
      title: 'Queued Jobs',
      value: String(stats?.queuedJobs ?? 0),
      description: 'Jobs waiting to run',
    },
  ];

  const recentActivityRows = (stats?.recentActivity ?? []).slice(0, 5).map((activity) => [
    activity.timestamp
      ? new Date(activity.timestamp).toLocaleTimeString()
      : '-',
    activity.entityType,
    <SyncStatusBadge key={activity.id} status={activity.status as SyncStatus} />,
    String(activity.recordsProcessed),
  ]);

  const entityBreakdownRows = (stats?.entityBreakdown ?? []).map((entity) => [
    entity.entityType,
    String(entity.total),
    <Badge key={`s-${entity.entityType}`} status="success">
      {entity.succeeded}
    </Badge>,
    entity.failed > 0 ? (
      <Badge key={`f-${entity.entityType}`} status="critical">
        {entity.failed}
      </Badge>
    ) : (
      <Badge key={`f-${entity.entityType}`} status="info">
        0
      </Badge>
    ),
  ]);

  return (
    <Page
      title="Dashboard"
      subtitle="Monitor and manage your Shopify-Oracle integration"
      primaryAction={{
        content: 'Refresh',
        icon: RefreshIcon,
        onAction: () => refetchStats(),
      }}
    >
      <Layout>
        {/* Summary Cards */}
        <Layout.Section>
          <Grid columns={{ xs: 1, sm: 2, md: 4 }}>
            {summaryCards.map((card) => (
              <Grid.Cell key={card.title}>
                <Card padding="400">
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingXs" tone="subdued">
                      {card.title}
                    </Text>
                    <Text as="p" variant="headingXl" fontWeight="bold">
                      {card.value}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {card.description}
                    </Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            ))}
          </Grid>
        </Layout.Section>

        {/* Quick Sync Buttons */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Quick Sync
                </Text>
                <Button
                  variant="plain"
                  icon={ViewListIcon}
                  onClick={handleViewAllSyncs}
                >
                  View All
                </Button>
              </InlineStack>
              <ButtonGroup wrap>
                <Button
                  onClick={() => handleManualSync('item')}
                  loading={triggerSyncMutation.isPending && triggerSyncMutation.variables?.entityType === 'item'}
                >
                  Sync Items
                </Button>
                <Button
                  onClick={() => handleManualSync('inventory')}
                  loading={triggerSyncMutation.isPending && triggerSyncMutation.variables?.entityType === 'inventory'}
                >
                  Sync Inventory
                </Button>
                <Button
                  onClick={() => handleManualSync('price')}
                  loading={triggerSyncMutation.isPending && triggerSyncMutation.variables?.entityType === 'price'}
                >
                  Sync Prices
                </Button>
                <Button
                  onClick={() => handleManualSync('customer')}
                  loading={triggerSyncMutation.isPending && triggerSyncMutation.variables?.entityType === 'customer'}
                >
                  Sync Customers
                </Button>
                <Button
                  onClick={() => handleManualSync('order')}
                  loading={triggerSyncMutation.isPending && triggerSyncMutation.variables?.entityType === 'order'}
                >
                  Sync Orders
                </Button>
              </ButtonGroup>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Recent Activity and Entity Breakdown */}
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Recent Activity
              </Text>
              {recentActivityRows.length > 0 ? (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'numeric']}
                  headings={['Time', 'Entity', 'Status', 'Records']}
                  rows={recentActivityRows}
                  defaultSortDirection="descending"
                  initialSortColumnIndex={0}
                />
              ) : (
                <EmptyState heading="No recent activity" image="">
                  <p>Sync jobs will appear here once you start synchronizing data.</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Entity Breakdown
              </Text>
              {entityBreakdownRows.length > 0 ? (
                <DataTable
                  columnContentTypes={['text', 'numeric', 'numeric', 'numeric']}
                  headings={['Entity', 'Total', 'Succeeded', 'Failed']}
                  rows={entityBreakdownRows}
                />
              ) : (
                <EmptyState heading="No sync data yet" image="">
                  <p>Sync statistics will appear here after your first sync job completes.</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
