import React, { useCallback, useContext, useMemo, useState } from 'react';
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
  Tabs,
  SkeletonPage,
  SkeletonBodyText,
  Modal,
  Form,
  FormLayout,
  TextField,
  Checkbox,
} from '@shopify/polaris';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../hooks/useApi';
import { AppContext } from '../../App';

interface FieldMapping {
  id: string;
  entity_type: string;
  direction: string;
  shopify_field: string;
  oracle_field: string;
  transform_rule: Record<string, unknown> | null;
  is_required: boolean;
}

const ENTITY_TYPES = ['item', 'customer', 'order', 'price', 'inventory'] as const;
const DIRECTIONS = ['shopify_to_oracle', 'oracle_to_shopify'] as const;

interface NewMappingForm {
  entityType: string;
  direction: string;
  shopifyField: string;
  oracleField: string;
  isRequired: boolean;
}

const initialForm: NewMappingForm = {
  entityType: 'item',
  direction: 'shopify_to_oracle',
  shopifyField: '',
  oracleField: '',
  isRequired: false,
};

/**
 * Field Mapping management page.
 * Allows viewing, adding, editing, and removing field mappings
 * between Shopify and Oracle fields.
 */
export function FieldMapping() {
  const { get, post, put, del } = useApi();
  const queryClient = useQueryClient();
  const { showToast } = useContext(AppContext);

  const [selectedTab, setSelectedTab] = useState(0);
  const [modalActive, setModalActive] = useState(false);
  const [editingMapping, setEditingMapping] = useState<FieldMapping | null>(null);
  const [form, setForm] = useState<NewMappingForm>(initialForm);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Filter by entity type based on selected tab
  const selectedEntity = ENTITY_TYPES[selectedTab] || 'item';

  // Fetch all field mappings
  const {
    data: allMappings,
    isLoading,
    error,
    refetch,
  } = useQuery<FieldMapping[]>({
    queryKey: ['field-mappings'],
    queryFn: () => get<FieldMapping[]>('/configuration/field-mappings'),
  });

  // Filter mappings for the selected entity
  const filteredMappings = useMemo(() => {
    if (!allMappings) return [];
    return allMappings.filter((m) => m.entity_type === selectedEntity);
  }, [allMappings, selectedEntity]);

  // Separate by direction
  const shopifyToOracleMappings = useMemo(
    () => filteredMappings.filter((m) => m.direction === 'shopify_to_oracle'),
    [filteredMappings]
  );

  const oracleToShopifyMappings = useMemo(
    () => filteredMappings.filter((m) => m.direction === 'oracle_to_shopify'),
    [filteredMappings]
  );

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (mappingId: string) => {
      await del(`/configuration/field-mappings/${mappingId}`);
    },
    onSuccess: () => {
      showToast('Field mapping deleted');
      queryClient.invalidateQueries({ queryKey: ['field-mappings'] });
    },
  });

  // Save mutation (create or update)
  const saveMutation = useMutation({
    mutationFn: async (data: NewMappingForm & { id?: string }) => {
      if (data.id) {
        return await put<FieldMapping>(`/configuration/field-mappings/${data.id}`, data);
      } else {
        return await post<FieldMapping>('/configuration/field-mappings', data);
      }
    },
    onSuccess: () => {
      showToast('Field mapping saved');
      queryClient.invalidateQueries({ queryKey: ['field-mappings'] });
      setModalActive(false);
      setForm(initialForm);
      setEditingMapping(null);
    },
  });

  const validateForm = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    if (!form.shopifyField.trim()) errors.shopifyField = 'Shopify field is required';
    if (!form.oracleField.trim()) errors.oracleField = 'Oracle field is required';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [form]);

  const handleAddMapping = useCallback(() => {
    setEditingMapping(null);
    setForm({
      ...initialForm,
      entityType: selectedEntity,
    });
    setFormErrors({});
    setModalActive(true);
  }, [selectedEntity]);

  const handleEditMapping = useCallback((mapping: FieldMapping) => {
    setEditingMapping(mapping);
    setForm({
      entityType: mapping.entity_type,
      direction: mapping.direction,
      shopifyField: mapping.shopify_field,
      oracleField: mapping.oracle_field,
      isRequired: mapping.is_required,
    });
    setFormErrors({});
    setModalActive(true);
  }, []);

  const handleDeleteMapping = useCallback(
    async (mapping: FieldMapping) => {
      if (window.confirm(`Delete mapping "${mapping.shopify_field} -> ${mapping.oracle_field}"?`)) {
        await deleteMutation.mutateAsync(mapping.id);
      }
    },
    [deleteMutation]
  );

  const handleSaveMapping = useCallback(async () => {
    if (!validateForm()) return;

    const data = {
      ...form,
      id: editingMapping?.id,
    };
    await saveMutation.mutateAsync(data);
  }, [form, editingMapping, saveMutation, validateForm]);

  const handleModalClose = useCallback(() => {
    setModalActive(false);
    setForm(initialForm);
    setEditingMapping(null);
    setFormErrors({});
  }, []);

  // Build table rows for a direction group
  const buildTableRows = (mappings: FieldMapping[], direction: string) => {
    if (mappings.length === 0) return [];

    return mappings.map((mapping) => [
      mapping.shopify_field,
      mapping.oracle_field,
      mapping.transform_rule ? (
        <Badge key={`t-${mapping.id}`} status="info">
          Yes
        </Badge>
      ) : (
        <Badge key={`t-${mapping.id}`} status="info">
          No
        </Badge>
      ),
      mapping.is_required ? (
        <Badge key={`r-${mapping.id}`} status="critical">
          Required
        </Badge>
      ) : (
        <Badge key={`r-${mapping.id}`} status="info">
          Optional
        </Badge>
      ),
      <InlineStack key={`a-${mapping.id}`} gap="200">
        <Button variant="plain" onClick={() => handleEditMapping(mapping)}>
          Edit
        </Button>
        <Button variant="plain" tone="critical" onClick={() => handleDeleteMapping(mapping)}>
          Delete
        </Button>
      </InlineStack>,
    ]);
  };

  const tabs = ENTITY_TYPES.map((type) => ({
    id: type,
    content: type.charAt(0).toUpperCase() + type.slice(1),
    accessibilityLabel: `${type} mappings`,
    panelID: `${type}-panel`,
  }));

  // Loading state
  if (isLoading) {
    return (
      <SkeletonPage title="Field Mapping" primaryAction>
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
      <Page title="Field Mapping">
        <Banner status="critical" title="Failed to load field mappings">
          <p>Unable to load field mappings. Please try again.</p>
          <Button onClick={() => refetch()}>Retry</Button>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title="Field Mapping"
      subtitle="Define how Shopify fields map to Oracle fields"
      primaryAction={{
        content: 'Add Mapping',
        onAction: handleAddMapping,
      }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />

            {shopifyToOracleMappings.length === 0 && oracleToShopifyMappings.length === 0 ? (
              <Box padding="400">
                <EmptyState
                  heading={`No mappings for ${selectedEntity}`}
                  action={{ content: 'Add Mapping', onAction: handleAddMapping }}
                  image=""
                >
                  <p>
                    Add field mappings to define how {selectedEntity} data is
                    transformed between Shopify and Oracle.
                  </p>
                </EmptyState>
              </Box>
            ) : (
              <BlockStack gap="400">
                {/* Shopify to Oracle */}
                {shopifyToOracleMappings.length > 0 && (
                  <Box padding="400">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        Shopify to Oracle
                      </Text>
                      <DataTable
                        columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                        headings={['Shopify Field', 'Oracle Field', 'Transform', 'Required', 'Actions']}
                        rows={buildTableRows(shopifyToOracleMappings, 'shopify_to_oracle')}
                      />
                    </BlockStack>
                  </Box>
                )}

                {/* Oracle to Shopify */}
                {oracleToShopifyMappings.length > 0 && (
                  <Box padding="400">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        Oracle to Shopify
                      </Text>
                      <DataTable
                        columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                        headings={['Oracle Field', 'Shopify Field', 'Transform', 'Required', 'Actions']}
                        rows={buildTableRows(oracleToShopifyMappings, 'oracle_to_shopify')}
                      />
                    </BlockStack>
                  </Box>
                )}
              </BlockStack>
            )}
          </Card>
        </Layout.Section>

        {/* Add/Edit Mapping Modal */}
        <Modal
          open={modalActive}
          onClose={handleModalClose}
          title={editingMapping ? 'Edit Field Mapping' : 'Add Field Mapping'}
          primaryAction={{
            content: 'Save',
            onAction: handleSaveMapping,
            loading: saveMutation.isPending,
          }}
          secondaryActions={[
            {
              content: 'Cancel',
              onAction: handleModalClose,
            },
          ]}
        >
          <Modal.Section>
            <Form onSubmit={handleSaveMapping}>
              <FormLayout>
                <Select
                  label="Entity Type"
                  options={ENTITY_TYPES.map((t) => ({
                    label: t.charAt(0).toUpperCase() + t.slice(1),
                    value: t,
                  }))}
                  value={form.entityType}
                  onChange={(value) =>
                    setForm((prev) => ({ ...prev, entityType: value }))
                  }
                  disabled={!!editingMapping}
                />

                <Select
                  label="Direction"
                  options={[
                    { label: 'Shopify to Oracle', value: 'shopify_to_oracle' },
                    { label: 'Oracle to Shopify', value: 'oracle_to_shopify' },
                  ]}
                  value={form.direction}
                  onChange={(value) =>
                    setForm((prev) => ({ ...prev, direction: value }))
                  }
                  disabled={!!editingMapping}
                />

                <TextField
                  label="Shopify Field"
                  value={form.shopifyField}
                  onChange={(value) =>
                    setForm((prev) => ({ ...prev, shopifyField: value }))
                  }
                  placeholder="e.g., title, price, inventory_quantity"
                  error={formErrors.shopifyField}
                  autoComplete="off"
                />

                <TextField
                  label="Oracle Field"
                  value={form.oracleField}
                  onChange={(value) =>
                    setForm((prev) => ({ ...prev, oracleField: value }))
                  }
                  placeholder="e.g., ItemDescription, ListPrice"
                  error={formErrors.oracleField}
                  autoComplete="off"
                />

                <Checkbox
                  label="Required field — sync will fail if this field is missing"
                  checked={form.isRequired}
                  onChange={(checked) =>
                    setForm((prev) => ({ ...prev, isRequired: checked }))
                  }
                />
              </FormLayout>
            </Form>
          </Modal.Section>
        </Modal>
      </Layout>
    </Page>
  );
}
