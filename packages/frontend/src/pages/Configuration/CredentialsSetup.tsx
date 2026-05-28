import React, { useCallback, useContext, useState } from 'react';
import {
  Page,
  Layout,
  Card,
  Form,
  FormLayout,
  TextField,
  Button,
  Banner,
  Spinner,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Box,
  Checkbox,
} from '@shopify/polaris';
import { useApi } from '../../hooks/useApi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppContext } from '../../App';

interface OracleCredentials {
  id?: string;
  base_url: string;
  username: string;
  password: string;
  identity_domain: string;
  is_valid: boolean;
}

interface FormErrors {
  baseUrl?: string;
  username?: string;
  password?: string;
}

/**
 * Oracle credentials configuration page.
 * Allows users to set or update their Oracle Netsuite connection details.
 */
export function CredentialsSetup() {
  const { get, post, put } = useApi();
  const queryClient = useQueryClient();
  const { showToast } = useContext(AppContext);

  const [formData, setFormData] = useState<OracleCredentials>({
    base_url: '',
    username: '',
    password: '',
    identity_domain: '',
    is_valid: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  // Fetch existing credentials
  const {
    data: existingCredentials,
    isLoading,
    error,
    refetch,
  } = useQuery<OracleCredentials | null>({
    queryKey: ['oracle-credentials'],
    queryFn: async () => {
      try {
        return await get<OracleCredentials>('/configuration/credentials');
      } catch {
        return null;
      }
    },
  });

  // Populate form when data is loaded
  React.useEffect(() => {
    if (existingCredentials) {
      setFormData({
        id: existingCredentials.id,
        base_url: existingCredentials.base_url || '',
        username: existingCredentials.username || '',
        password: '',
        identity_domain: existingCredentials.identity_domain || '',
        is_valid: existingCredentials.is_valid,
      });
    }
  }, [existingCredentials]);

  // Save credentials mutation
  const saveMutation = useMutation({
    mutationFn: async (data: OracleCredentials) => {
      if (data.id) {
        return await put<OracleCredentials>('/configuration/credentials', data);
      } else {
        return await post<OracleCredentials>('/configuration/credentials', data);
      }
    },
    onSuccess: () => {
      showToast('Oracle credentials saved successfully');
      queryClient.invalidateQueries({ queryKey: ['oracle-credentials'] });
      refetch();
    },
    onError: () => {
      // Error toast is handled by useApi
    },
  });

  // Test connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      return await post<{ success: boolean; message: string }>(
        '/configuration/credentials/test',
        formData
      );
    },
    onSuccess: (data) => {
      if (data.success) {
        showToast('Connection test successful!', {});
        queryClient.invalidateQueries({ queryKey: ['oracle-credentials'] });
      } else {
        showToast(data.message || 'Connection test failed', { error: true });
      }
    },
    onError: () => {
      // Error toast is handled by useApi
    },
  });

  // Validation
  const validateForm = useCallback((): boolean => {
    const errors: FormErrors = {};

    if (!formData.base_url.trim()) {
      errors.baseUrl = 'Base URL is required';
    } else if (
      !formData.base_url.startsWith('https://') &&
      !formData.base_url.startsWith('http://')
    ) {
      errors.baseUrl = 'URL must start with http:// or https://';
    }

    if (!formData.username.trim()) {
      errors.username = 'Username is required';
    }

    if (!formData.password.trim()) {
      errors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formData]);

  const handleFieldChange = useCallback(
    (field: keyof OracleCredentials) => (value: string) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      // Clear field error on change
      if (formErrors[field as keyof FormErrors]) {
        setFormErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    },
    [formErrors]
  );

  const handleSave = useCallback(async () => {
    if (!validateForm()) {
      showToast('Please fix the form errors before saving', { error: true });
      return;
    }
    await saveMutation.mutateAsync(formData);
  }, [validateForm, saveMutation, formData, showToast]);

  const handleTestConnection = useCallback(async () => {
    if (!validateForm()) {
      showToast('Please fix the form errors before testing', { error: true });
      return;
    }
    await testConnectionMutation.mutateAsync();
  }, [validateForm, testConnectionMutation, formData, showToast]);

  const handleClearForm = useCallback(() => {
    setFormData({
      base_url: '',
      username: '',
      password: '',
      identity_domain: '',
      is_valid: false,
    });
    setFormErrors({});
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <Page title="Oracle Credentials">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" align="center">
                <Spinner size="large" />
                <Text as="p" tone="subdued">
                  Loading credentials...
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // Error state
  if (error) {
    return (
      <Page title="Oracle Credentials">
        <Banner status="critical" title="Failed to load credentials">
          <p>Unable to load existing credentials. You can still configure new ones.</p>
        </Banner>
        <br />
      </Page>
    );
  }

  return (
    <Page
      title="Oracle Credentials"
      subtitle="Configure your Oracle Netsuite connection details"
      primaryAction={{
        content: 'Save',
        onAction: handleSave,
        loading: saveMutation.isPending,
      }}
      secondaryActions={[
        {
          content: 'Test Connection',
          onAction: handleTestConnection,
          loading: testConnectionMutation.isPending,
        },
        {
          content: 'Clear',
          onAction: handleClearForm,
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              {existingCredentials && (
                <Banner status={existingCredentials.is_valid ? 'success' : 'warning'}>
                  <p>
                    {existingCredentials.is_valid
                      ? 'Your Oracle credentials are valid and connected.'
                      : 'Your saved credentials have not been validated. Test your connection.'}
                  </p>
                </Banner>
              )}

              <Form onSubmit={handleSave}>
                <FormLayout>
                  <TextField
                    label="Oracle Base URL"
                    type="url"
                    value={formData.base_url}
                    onChange={handleFieldChange('base_url')}
                    placeholder="https://your-instance.oracle.com"
                    helpText="The base URL of your Oracle Netsuite instance"
                    error={formErrors.baseUrl}
                    autoComplete="url"
                  />

                  <TextField
                    label="Username"
                    type="text"
                    value={formData.username}
                    onChange={handleFieldChange('username')}
                    placeholder="admin@company.com"
                    helpText="Oracle Netsuite account username or email"
                    error={formErrors.username}
                    autoComplete="username"
                  />

                  <TextField
                    label="Password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={handleFieldChange('password')}
                    placeholder={existingCredentials ? 'Enter new password to change' : ''}
                    helpText={
                      existingCredentials
                        ? 'Leave blank to keep existing password'
                        : 'Oracle Netsuite account password'
                    }
                    error={formErrors.password}
                    autoComplete="current-password"
                    connectedRight={
                      <Checkbox
                        label="Show"
                        checked={showPassword}
                        onChange={(checked) => setShowPassword(checked)}
                      />
                    }
                  />

                  <TextField
                    label="Identity Domain (Optional)"
                    type="text"
                    value={formData.identity_domain}
                    onChange={handleFieldChange('identity_domain')}
                    placeholder="identity-domain.oracle.com"
                    helpText="Oracle Cloud identity domain for authentication"
                    autoComplete="off"
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
                Connection Status
              </Text>
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" fontWeight="bold">
                  Status:
                </Text>
                <Badge status={formData.is_valid ? 'success' : 'info'}>
                  {formData.is_valid ? 'Connected' : 'Not Tested'}
                </Badge>
              </InlineStack>
              {formData.is_valid && existingCredentials?.base_url && (
                <Text as="p" variant="bodySm" tone="subdued">
                  Connected to: {existingCredentials.base_url}
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingSm">
                Requirements
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                To connect to Oracle Netsuite, you need:
              </Text>
              <Box paddingBlockStart="200">
                <Text as="p" variant="bodySm">
                  - A valid Oracle Netsuite account with API access
                </Text>
                <Text as="p" variant="bodySm">
                  - The base URL of your Oracle instance
                </Text>
                <Text as="p" variant="bodySm">
                  - API role with appropriate permissions for data access
                </Text>
                <Text as="p" variant="bodySm">
                  - Network access to allow outbound requests to Oracle
                </Text>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
