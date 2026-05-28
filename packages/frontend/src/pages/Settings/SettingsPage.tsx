import React, { useCallback, useContext, useState } from 'react';
import {
  Page,
  Layout,
  Card,
  Form,
  FormLayout,
  TextField,
  Select,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Checkbox,
  Box,
  ButtonGroup,
} from '@shopify/polaris';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../hooks/useApi';
import { AppContext } from '../../App';

interface AppSettings {
  shopifyApiVersion: string;
  logLevel: string;
  maxRetries: number;
  notifyOnFailure: boolean;
  notifyEmail: string;
  webhookEnabled: boolean;
  autoResolveConflicts: boolean;
}

const defaultSettings: AppSettings = {
  shopifyApiVersion: '2024-07',
  logLevel: 'info',
  maxRetries: 3,
  notifyOnFailure: true,
  notifyEmail: '',
  webhookEnabled: true,
  autoResolveConflicts: false,
};

const API_VERSION_OPTIONS = [
  { label: '2024-07 (Stable)', value: '2024-07' },
  { label: '2024-04', value: '2024-04' },
  { label: '2024-01', value: '2024-01' },
  { label: '2023-10', value: '2023-10' },
];

const LOG_LEVEL_OPTIONS = [
  { label: 'Error', value: 'error' },
  { label: 'Warning', value: 'warn' },
  { label: 'Info', value: 'info' },
  { label: 'Debug', value: 'debug' },
];

/**
 * Settings page for application-wide configuration.
 */
export function SettingsPage() {
  const { get, put } = useApi();
  const queryClient = useQueryClient();
  const { showToast } = useContext(AppContext);

  const [formData, setFormData] = useState<AppSettings>(defaultSettings);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch current settings
  const { data: settings, isLoading, error, refetch } = useQuery<AppSettings>({
    queryKey: ['app-settings'],
    queryFn: async () => {
      try {
        return await get<AppSettings>('/settings');
      } catch {
        return defaultSettings;
      }
    },
  });

  // Populate form from loaded settings
  React.useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

  // Save settings mutation
  const saveMutation = useMutation({
    mutationFn: async (data: AppSettings) => {
      return await put<AppSettings>('/settings', data);
    },
    onSuccess: () => {
      showToast('Settings saved successfully');
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ['app-settings'] });
    },
    onError: () => {
      showToast('Failed to save settings', { error: true });
    },
  });

  const handleFieldChange = useCallback(
    <K extends keyof AppSettings>(field: K) =>
      (value: AppSettings[K]) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        setHasChanges(true);
      },
    []
  );

  const handleSave = useCallback(() => {
    saveMutation.mutate(formData);
  }, [formData, saveMutation]);

  const handleReset = useCallback(() => {
    if (settings) {
      setFormData(settings);
    } else {
      setFormData(defaultSettings);
    }
    setHasChanges(false);
  }, [settings]);

  const handleClearCache = useCallback(async () => {
    try {
      await put('/settings/clear-cache', {});
      showToast('Cache cleared successfully');
    } catch {
      showToast('Failed to clear cache', { error: true });
    }
  }, [put, showToast]);

  return (
    <Page
      title="Settings"
      subtitle="Application-wide configuration"
      primaryAction={{
        content: 'Save Settings',
        onAction: handleSave,
        loading: saveMutation.isPending,
        disabled: !hasChanges,
      }}
      secondaryActions={[
        {
          content: 'Reset',
          onAction: handleReset,
          disabled: !hasChanges,
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          {/* General Settings */}
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                General Settings
              </Text>

              {error && (
                <Banner status="warning" title="Failed to load settings">
                  <p>
                    Could not load current settings. Default values are displayed.
                  </p>
                </Banner>
              )}

              <Form onSubmit={handleSave}>
                <FormLayout>
                  <Select
                    label="Shopify API Version"
                    options={API_VERSION_OPTIONS}
                    value={formData.shopifyApiVersion}
                    onChange={handleFieldChange('shopifyApiVersion')}
                    helpText="The Shopify Admin API version used for API calls"
                  />

                  <Select
                    label="Log Level"
                    options={LOG_LEVEL_OPTIONS}
                    value={formData.logLevel}
                    onChange={handleFieldChange('logLevel')}
                    helpText="Verbosity of application logs. Debug is most verbose."
                  />

                  <TextField
                    label="Max Retries"
                    type="number"
                    value={String(formData.maxRetries)}
                    onChange={(value) =>
                      handleFieldChange('maxRetries')(parseInt(value, 10) || 3)
                    }
                    min={0}
                    max={10}
                    helpText="Maximum number of retry attempts for failed sync operations (0-10)"
                    autoComplete="off"
                  />

                  <TextField
                    label="Notification Email"
                    type="email"
                    value={formData.notifyEmail}
                    onChange={handleFieldChange('notifyEmail')}
                    placeholder="admin@example.com"
                    helpText="Email address for failure notifications (optional)"
                    autoComplete="email"
                  />
                </FormLayout>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">
                Feature Toggles
              </Text>

              <Checkbox
                label="Enable webhook processing"
                checked={formData.webhookEnabled}
                onChange={handleFieldChange('webhookEnabled')}
                helpText="Process incoming webhooks from Shopify for real-time sync triggers"
              />

              <Checkbox
                label="Notify on sync failures"
                checked={formData.notifyOnFailure}
                onChange={handleFieldChange('notifyOnFailure')}
                helpText="Send email notification when a sync job fails"
              />

              <Checkbox
                label="Auto-resolve conflicts"
                checked={formData.autoResolveConflicts}
                onChange={handleFieldChange('autoResolveConflicts')}
                helpText="Automatically resolve data conflicts using the configured strategy"
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingSm">
                Actions
              </Text>

              <ButtonGroup fullWidth>
                <Button onClick={handleClearCache}>Clear Cache</Button>
                <Button
                  onClick={() => window.location.href = '/api/auth/logout'}
                  tone="critical"
                >
                  Log Out
                </Button>
              </ButtonGroup>

              <Box paddingBlockStart="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  App Version: 1.0.0
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Environment: {import.meta.env.MODE}
                </Text>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
