import React, { useCallback, useContext, useState } from 'react';
import {
  Page,
  Layout,
  Card,
  Form,
  FormLayout,
  Select,
  Button,
  Banner,
  Spinner,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  TextField,
  EmptyState,
  SkeletonPage,
  SkeletonBodyText,
} from '@shopify/polaris';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../hooks/useApi';
import { AppContext } from '../../App';

interface SyncConfig {
  id: string;
  store_id: string;
  entity_type: string;
  frequency: 'real_time' | 'scheduled' | 'manual';
  cron_expression: string | null;
  is_enabled: boolean;
  batch_size: number;
  conflict_strategy: 'source_wins' | 'target_wins' | 'manual' | 'merge';
}

const ENTITY_TYPES = ['item', 'customer', 'order', 'price', 'inventory'] as const;

const FREQUENCY_OPTIONS = [
  { label: 'Real Time', value: 'real_time', description: 'Sync instantly when data changes' },
  { label: 'Scheduled', value: 'scheduled', description: 'Sync on a cron schedule' },
  { label: 'Manual', value: 'manual', description: 'Sync only when manually triggered' },
];

const CONFLICT_OPTIONS = [
  { label: 'Source Wins', value: 'source_wins', description: 'Source system data always overwrites target' },
  { label: 'Target Wins', value: 'target_wins', description: 'Target system data is preserved' },
  { label: 'Manual', value: 'manual', description: 'Flag conflicts for manual resolution' },
  { label: 'Merge', value: 'merge', description: 'Attempt to merge conflicting fields' },
];

interface ConfigFormData {
  frequency: string;
  cronExpression: string;
  batchSize: number;
  conflictStrategy: string;
  isEnabled: boolean;
}

/**
 * Sync Frequency and Schedule configuration page.
 * Allows per-entity configuration of sync frequency, batch sizes,
 * conflict resolution strategies, and cron scheduling.
 */
export function SyncFrequency() {
  const { get, put } = useApi();
  const queryClient = useQueryClient();
  const { showToast } = useContext(AppContext);

  const [selectedEntity, setSelectedEntity] = useState('item');
  const [formData, setFormData] = useState<ConfigFormData>({
    frequency: 'manual',
    cronExpression: '',
    batchSize: 100,
    conflictStrategy: 'source_wins',
    isEnabled: true,
  });

  // Fetch all sync configs
  const {
    data: configs,
    isLoading,
    error,
    refetch,
  } = useQuery<SyncConfig[]>({
    queryKey: ['sync-configs'],
    queryFn: () => get<SyncConfig[]>('/configuration/sync-configs'),
  });

  // Load form data when selected entity changes or configs load
  React.useEffect(() => {
    const config = configs?.find((c) => c.entity_type === selectedEntity);
    if (config) {
      setFormData({
        frequency: config.frequency,
        cronExpression: config.cron_expression || '',
        batchSize: config.batch_size,
        conflictStrategy: config.conflict_strategy,
        isEnabled: config.is_enabled,
      });
    } else {
      setFormData({
        frequency: 'manual',
        cronExpression: '',
        batchSize: 100,
        conflictStrategy: 'source_wins',
        isEnabled: true,
      });
    }
  }, [configs, selectedEntity]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: ConfigFormData & { entityType: string }) => {
      return await put<SyncConfig>(`/configuration/sync-configs/${data.entityType}`, {
        frequency: data.frequency,
        cron_expression: data.frequency === 'scheduled' ? data.cronExpression : null,
        batch_size: data.batchSize,
        conflict_strategy: data.conflictStrategy,
        is_enabled: data.isEnabled,
      });
    },
    onSuccess: () => {
      showToast('Sync configuration saved');
      queryClient.invalidateQueries({ queryKey: ['sync-configs'] });
    },
  });

  const handleSave = useCallback(async () => {
    if (formData.frequency === 'scheduled' && !formData.cronExpression.trim()) {
      showToast('Cron expression is required for scheduled sync', { error: true });
      return;
    }

    await saveMutation.mutateAsync({
      ...formData,
      entityType: selectedEntity,
    });
  }, [formData, selectedEntity, saveMutation, showToast]);

  const handleEntityChange = useCallback((value: string) => {
    setSelectedEntity(value);
  }, []);

  const handleFieldChange = useCallback(
    <K extends keyof ConfigFormData>(field: K) =>
      (value: ConfigFormData[K]) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
      },
    []
  );

  // Loading state
  if (isLoading) {
    return (
      <SkeletonPage title="Sync Frequency">
        <Layout>
          <Layout.Section>
            <SkeletonBodyText lines={8} />
          </Layout.Section>
        </Layout>
      </SkeletonPage>
    );
  }

  // Error state
  if (error) {
    return (
      <Page title="Sync Frequency">
        <Banner status="critical" title="Failed to load sync configurations">
          <p>Unable to load sync configurations. Please try again.</p>
          <Button onClick={() => refetch()}>Retry</Button>
        </Banner>
      </Page>
    );
  }

  // Current config summary for the selected entity
  const currentConfig = configs?.find((c) => c.entity_type === selectedEntity);

  return (
    <Page
      title="Sync Frequency"
      subtitle="Configure synchronization schedules for each entity type"
      primaryAction={{
        content: 'Save Configuration',
        onAction: handleSave,
        loading: saveMutation.isPending,
      }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Select
                label="Entity Type"
                options={ENTITY_TYPES.map((t) => ({
                  label: t.charAt(0).toUpperCase() + t.slice(1),
                  value: t,
                }))}
                value={selectedEntity}
                onChange={handleEntityChange}
              />

              <Form onSubmit={handleSave}>
                <FormLayout>
                  <Select
                    label="Sync Frequency"
                    options={FREQUENCY_OPTIONS}
                    value={formData.frequency}
                    onChange={handleFieldChange('frequency')}
                    helpText={
                      formData.frequency === 'real_time'
                        ? 'Data will be synced immediately when changes are detected via webhooks'
                        : formData.frequency === 'scheduled'
                        ? 'Data will be synced on the cron schedule specified below'
                        : 'Data will only sync when manually triggered from the dashboard'
                    }
                  />

                  {formData.frequency === 'scheduled' && (
                    <TextField
                      label="Cron Expression"
                      value={formData.cronExpression}
                      onChange={handleFieldChange('cronExpression')}
                      placeholder="*/30 * * * *"
                      helpText="Standard cron expression. Example: '0 */2 * * *' = every 2 hours"
                      autoComplete="off"
                    />
                  )}

                  <TextField
                    label="Batch Size"
                    type="number"
                    value={String(formData.batchSize)}
                    onChange={(value) =>
                      handleFieldChange('batchSize')(parseInt(value, 10) || 100)
                    }
                    min={1}
                    max={500}
                    helpText="Number of records to process per batch (1-500)"
                    autoComplete="off"
                  />

                  <Select
                    label="Conflict Resolution Strategy"
                    options={CONFLICT_OPTIONS}
                    value={formData.conflictStrategy}
                    onChange={handleFieldChange('conflictStrategy')}
                    helpText="Determines how data conflicts between Shopify and Oracle are resolved"
                  />
                </FormLayout>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingSm">
                Current Configuration
              </Text>
              {currentConfig ? (
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <Text as="span" fontWeight="bold" variant="bodySm">
                      Frequency:
                    </Text>
                    <Badge
                      status={
                        currentConfig.frequency === 'real_time'
                          ? 'success'
                          : currentConfig.frequency === 'scheduled'
                          ? 'attention'
                          : 'info'
                      }
                    >
                      {currentConfig.frequency}
                    </Badge>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <Text as="span" fontWeight="bold" variant="bodySm">
                      Status:
                    </Text>
                    <Badge status={currentConfig.is_enabled ? 'success' : 'critical'}>
                      {currentConfig.is_enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Batch Size: {currentConfig.batch_size}
                  </Text>
                  {currentConfig.cron_expression && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Schedule: {currentConfig.cron_expression}
                    </Text>
                  )}
                  <Text as="p" variant="bodySm" tone="subdued">
                    Conflict Strategy: {currentConfig.conflict_strategy.replace('_', ' ')}
                  </Text>
                </BlockStack>
              ) : (
                <EmptyState heading="No configuration yet" image="">
                  <p>Save a configuration for {selectedEntity} to see it here.</p>
                </EmptyState>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingSm">
                All Entities Overview
              </Text>
              {ENTITY_TYPES.map((entity) => {
                const cfg = configs?.find((c) => c.entity_type === entity);
                return (
                  <InlineStack key={entity} gap="200" blockAlign="center" wrap={false}>
                    <Text as="span" variant="bodySm" fontWeight="bold" minWidth="80px">
                      {entity.charAt(0).toUpperCase() + entity.slice(1)}
                    </Text>
                    <Badge
                      status={
                        cfg?.frequency === 'real_time'
                          ? 'success'
                          : cfg?.frequency === 'scheduled'
                          ? 'attention'
                          : 'info'
                      }
                      size="small"
                    >
                      {cfg?.frequency || 'Not configured'}
                    </Badge>
                    {cfg && (
                      <Badge
                        status={cfg.is_enabled ? 'success' : 'critical'}
                        size="small"
                      >
                        {cfg.is_enabled ? 'On' : 'Off'}
                      </Badge>
                    )}
                  </InlineStack>
                );
              })}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
