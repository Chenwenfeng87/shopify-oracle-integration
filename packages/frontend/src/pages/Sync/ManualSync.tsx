import React, { useCallback, useContext, useState } from 'react';
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  ButtonGroup,
  Banner,
  Badge,
  EmptyState,
  Select,
  Spinner,
  List,
  Box,
} from '@shopify/polaris';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { AppContext } from '../../App';

interface SyncOption {
  entityType: string;
  label: string;
  description: string;
  directions: { value: string; label: string }[];
}

const SYNC_OPTIONS: SyncOption[] = [
  {
    entityType: 'item',
    label: 'Items (Products)',
    description: 'Sync product catalog including titles, descriptions, prices, and SKUs',
    directions: [
      { value: 'oracle_to_shopify', label: 'Oracle to Shopify' },
      { value: 'shopify_to_oracle', label: 'Shopify to Oracle' },
    ],
  },
  {
    entityType: 'customer',
    label: 'Customers',
    description: 'Sync customer data including names, emails, and addresses',
    directions: [
      { value: 'shopify_to_oracle', label: 'Shopify to Oracle' },
      { value: 'oracle_to_shopify', label: 'Oracle to Shopify' },
    ],
  },
  {
    entityType: 'order',
    label: 'Orders',
    description: 'Sync order data including totals, statuses, and line items',
    directions: [
      { value: 'shopify_to_oracle', label: 'Shopify to Oracle' },
      { value: 'oracle_to_shopify', label: 'Oracle to Shopify' },
    ],
  },
  {
    entityType: 'price',
    label: 'Prices',
    description: 'Sync product pricing data including sales and compare-at prices',
    directions: [
      { value: 'shopify_to_oracle', label: 'Shopify to Oracle' },
      { value: 'oracle_to_shopify', label: 'Oracle to Shopify' },
    ],
  },
  {
    entityType: 'inventory',
    label: 'Inventory',
    description: 'Sync inventory levels and stock quantities',
    directions: [
      { value: 'oracle_to_shopify', label: 'Oracle to Shopify' },
      { value: 'shopify_to_oracle', label: 'Shopify to Oracle' },
    ],
  },
];

/**
 * Manual Sync trigger page.
 * Allows users to select entity types and directions,
 * then initiate sync jobs.
 */
export function ManualSync() {
  const { showToast } = useContext(AppContext);
  const { useTriggerManualSync, useSyncJobs } = useSyncStatus();
  const triggerSyncMutation = useTriggerManualSync();

  // Track per-entity direction choices
  const [directions, setDirections] = useState<Record<string, string>>({
    item: 'oracle_to_shopify',
    customer: 'shopify_to_oracle',
    order: 'shopify_to_oracle',
    price: 'shopify_to_oracle',
    inventory: 'oracle_to_shopify',
  });

  // Fetch recent jobs to show if syncs have been triggered
  const { data: recentJobs } = useSyncJobs({ page: 1, perPage: 5 });

  const handleDirectionChange = useCallback(
    (entityType: string) => (value: string) => {
      setDirections((prev) => ({ ...prev, [entityType]: value }));
    },
    []
  );

  const handleSync = useCallback(
    async (entityType: string) => {
      const direction = directions[entityType];
      try {
        await triggerSyncMutation.mutateAsync({
          entityType,
          direction,
        });
        showToast(`${entityType} sync triggered successfully (${direction})`);
      } catch {
        // Error toast handled by useApi
      }
    },
    [directions, triggerSyncMutation, showToast]
  );

  const handleSyncAll = useCallback(async () => {
    const entities = Object.keys(directions);
    for (const entityType of entities) {
      try {
        await triggerSyncMutation.mutateAsync({
          entityType,
          direction: directions[entityType],
        });
      } catch {
        // Continue with next entity
      }
    }
    showToast('All syncs triggered');
  }, [directions, triggerSyncMutation, showToast]);

  const isSyncing = triggerSyncMutation.isPending;

  return (
    <Page
      title="Manual Sync"
      subtitle="Trigger synchronization jobs for each entity type"
      primaryAction={{
        content: 'Sync All',
        onAction: handleSyncAll,
        loading: isSyncing,
        disabled: isSyncing,
      }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Select Entities to Sync
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Choose which data entities to synchronize and the direction of the sync.
                Each sync job will process the configured batch of records.
              </Text>

              {SYNC_OPTIONS.map((option) => (
                <Box
                  key={option.entityType}
                  padding="300"
                  borderRadius="200"
                  borderWidth="025"
                  borderColor="border"
                >
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center" wrap={false}>
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingSm">
                          {option.label}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {option.description}
                        </Text>
                      </BlockStack>

                      <InlineStack gap="200" blockAlign="center">
                        <div style={{ minWidth: '180px' }}>
                          <Select
                            label=""
                            options={option.directions}
                            value={directions[option.entityType]}
                            onChange={handleDirectionChange(option.entityType)}
                            disabled={isSyncing}
                          />
                        </div>
                        <Button
                          onClick={() => handleSync(option.entityType)}
                          loading={isSyncing}
                          disabled={isSyncing}
                        >
                          Sync Now
                        </Button>
                      </InlineStack>
                    </InlineStack>
                  </BlockStack>
                </Box>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">
                Recent Syncs
              </Text>
              {recentJobs && recentJobs.jobs.length > 0 ? (
                <List type="bullet">
                  {recentJobs.jobs.slice(0, 5).map((job) => (
                    <List.Item key={job.id}>
                      <InlineStack gap="200" blockAlign="center" wrap={false}>
                        <Text as="span" variant="bodySm">
                          {job.entityType}
                        </Text>
                        <Badge
                          status={
                            job.status === 'completed'
                              ? 'success'
                              : job.status === 'failed'
                              ? 'critical'
                              : job.status === 'running'
                              ? 'attention'
                              : 'info'
                          }
                          size="small"
                        >
                          {job.status}
                        </Badge>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {new Date(job.createdAt).toLocaleString()}
                        </Text>
                      </InlineStack>
                    </List.Item>
                  ))}
                </List>
              ) : (
                <EmptyState heading="No recent syncs" image="">
                  <p>Triggered syncs will appear here.</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingSm">
                Tips
              </Text>
              <Text as="p" variant="bodySm">
                - Items and Inventory typically sync from Oracle to Shopify
              </Text>
              <Text as="p" variant="bodySm">
                - Customers and Orders typically sync from Shopify to Oracle
              </Text>
              <Text as="p" variant="bodySm">
                - Prices can be synced in either direction depending on your pricing source
              </Text>
              <Text as="p" variant="bodySm">
                - Use "Sync All" to trigger all entities at once
              </Text>
              <Text as="p" variant="bodySm">
                - Monitor sync progress in the Sync Overview page
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
