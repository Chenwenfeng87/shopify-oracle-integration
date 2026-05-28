import React, { useCallback, useContext, useMemo } from 'react';
import {
  Page,
  Layout,
  Card,
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
  Box,
  Grid,
  List,
} from '@shopify/polaris';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useApi } from '../../hooks/useApi';
import { AppContext } from '../../App';

interface Plan {
  id: string;
  name: string;
  description: string;
  price: number;
  features: string[];
  isPopular?: boolean;
}

interface Subscription {
  id: string;
  planName: string;
  status: string;
  amount: number;
  currency: string;
  trialEndsAt: string | null;
  createdAt: string;
}

const AVAILABLE_PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'For small stores just getting started with Oracle integration',
    price: 29,
    features: [
      'Up to 1,000 records per sync',
      'Manual sync only',
      'Basic field mapping',
      'Email support',
      'Single store',
    ],
  },
  {
    id: 'professional',
    name: 'Professional',
    description: 'For growing businesses with regular sync needs',
    price: 99,
    features: [
      'Up to 10,000 records per sync',
      'Scheduled and manual sync',
      'Advanced field mapping with transforms',
      'Priority email support',
      'Up to 3 stores',
      'Sync history (30 days)',
    ],
    isPopular: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'For large organizations with complex integration requirements',
    price: 299,
    features: [
      'Unlimited records per sync',
      'Real-time, scheduled, and manual sync',
      'Custom field mapping with advanced transforms',
      'Dedicated support engineer',
      'Unlimited stores',
      'Unlimited sync history',
      'SLA guarantee',
      'Custom integration services',
    ],
  },
];

/**
 * Billing page showing current subscription and available plans.
 */
export function BillingPage() {
  const { get, post } = useApi();
  const { showToast } = useContext(AppContext);

  // Fetch current subscription
  const {
    data: subscription,
    isLoading,
    error,
    refetch,
  } = useQuery<Subscription | null>({
    queryKey: ['billing', 'subscription'],
    queryFn: async () => {
      try {
        return await get<Subscription>('/billing/subscription');
      } catch {
        return null;
      }
    },
  });

  // Purchase / change plan mutation
  const purchaseMutation = useMutation({
    mutationFn: async (planId: string) => {
      return await post<{ confirmationUrl?: string }>('/billing/purchase', {
        planId,
      });
    },
    onSuccess: (data) => {
      if (data.confirmationUrl) {
        // Redirect to Shopify confirmation page
        window.location.href = data.confirmationUrl;
      } else {
        showToast('Plan changed successfully');
        refetch();
      }
    },
    onError: () => {
      showToast('Failed to process plan change', { error: true });
    },
  });

  const handleSelectPlan = useCallback(
    (planId: string) => {
      purchaseMutation.mutate(planId);
    },
    [purchaseMutation]
  );

  const handleManageBilling = useCallback(() => {
    window.location.href = '/api/billing/portal';
  }, []);

  // Determine current plan name
  const currentPlanName = subscription?.planName?.toLowerCase() || '';

  // Loading state
  if (isLoading) {
    return (
      <SkeletonPage title="Billing" primaryAction>
        <Layout>
          <Layout.Section>
            <SkeletonBodyText lines={4} />
          </Layout.Section>
          <Layout.Section>
            <SkeletonBodyText lines={8} />
          </Layout.Section>
        </Layout>
      </SkeletonPage>
    );
  }

  return (
    <Page
      title="Billing"
      subtitle="Manage your subscription plan"
    >
      <Layout>
        {/* Current Subscription */}
        <Layout.Section>
          {subscription ? (
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Current Subscription
                  </Text>
                  <Button onClick={handleManageBilling}>Manage Billing</Button>
                </InlineStack>

                <InlineStack gap="400" wrap={false}>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">Plan</Text>
                    <Text as="span" fontWeight="bold" variant="headingMd">
                      {subscription.planName}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">Status</Text>
                    <Badge
                      status={
                        subscription.status === 'active'
                          ? 'success'
                          : subscription.status === 'past_due'
                          ? 'warning'
                          : 'critical'
                      }
                    >
                      {subscription.status}
                    </Badge>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">Amount</Text>
                    <Text as="span" fontWeight="bold">
                      {subscription.currency} {subscription.amount.toFixed(2)}/mo
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">Since</Text>
                    <Text as="span">
                      {new Date(subscription.createdAt).toLocaleDateString()}
                    </Text>
                  </BlockStack>
                </InlineStack>

                {subscription.trialEndsAt && new Date(subscription.trialEndsAt) > new Date() && (
                  <Banner status="info" title="Trial Period">
                    <p>
                      Your trial ends on{' '}
                      {new Date(subscription.trialEndsAt).toLocaleDateString()}.
                      Upgrade to a paid plan to continue using the integration.
                    </p>
                  </Banner>
                )}

                {subscription.status === 'past_due' && (
                  <Banner status="warning" title="Payment Past Due">
                    <p>
                      Your payment is past due. Please update your billing information
                      to avoid service interruption.
                    </p>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          ) : (
            <Card>
              <EmptyState
                heading="No active subscription"
                action={{ content: 'Select a plan below to get started' }}
                image=""
              >
                <p>
                  Choose a plan that fits your needs. You can upgrade or cancel at any time.
                </p>
              </EmptyState>
            </Card>
          )}
        </Layout.Section>

        {/* Available Plans */}
        <Layout.Section>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Available Plans
            </Text>

            <Grid columns={{ xs: 1, sm: 1, md: 3 }}>
              {AVAILABLE_PLANS.map((plan) => {
                const isCurrentPlan = currentPlanName === plan.id;
                const isPopular = plan.isPopular;

                return (
                  <Grid.Cell key={plan.id}>
                    <Card padding="400">
                      <BlockStack gap="300">
                        {isPopular && (
                          <Badge status="success">Most Popular</Badge>
                        )}

                        <BlockStack gap="100">
                          <Text as="h3" variant="headingLg">
                            {plan.name}
                          </Text>
                          <Text as="p" variant="headingXl" fontWeight="bold">
                            ${plan.price}
                            <Text as="span" variant="bodySm" tone="subdued">
                              /month
                            </Text>
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {plan.description}
                          </Text>
                        </BlockStack>

                        <Box paddingBlock="200">
                          <List type="bullet">
                            {plan.features.map((feature) => (
                              <List.Item key={feature}>{feature}</List.Item>
                            ))}
                          </List>
                        </Box>

                        <Button
                          variant={isCurrentPlan ? undefined : 'primary'}
                          tone={isCurrentPlan ? undefined : undefined}
                          onClick={() => handleSelectPlan(plan.id)}
                          loading={
                            purchaseMutation.isPending &&
                            purchaseMutation.variables === plan.id
                          }
                          disabled={isCurrentPlan}
                        >
                          {isCurrentPlan ? 'Current Plan' : 'Select Plan'}
                        </Button>
                      </BlockStack>
                    </Card>
                  </Grid.Cell>
                );
              })}
            </Grid>
          </BlockStack>
        </Layout.Section>

        {error && (
          <Layout.Section>
            <Banner status="critical" title="Failed to load billing information">
              <p>Unable to load your subscription details. Please try again.</p>
              <Button onClick={() => refetch()}>Retry</Button>
            </Banner>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
