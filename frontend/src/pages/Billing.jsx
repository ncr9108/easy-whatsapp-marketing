import React, { useState, useEffect } from 'react';
import { Page, Layout, Text, BlockStack, InlineStack, Grid, Button, ProgressBar, Banner } from '@shopify/polaris';
import api from '../utils/api.js';
import Loader from '../components/Loader.jsx';

export default function Billing() {
  const [loading, setLoading] = useState(true);
  const [billing, setBilling] = useState(null);
  const [upgrading, setUpgrading] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  async function fetchBilling() {
    try {
      const response = await api.get('/billing/status');
      setBilling(response.data);
    } catch (error) {
      console.error('Error fetching billing details:', error);
      setErrorMsg('Failed to load subscription details.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBilling();
  }, []);

  async function handlePlanSelect(planName) {
    setUpgrading(planName);
    setErrorMsg('');
    try {
      const response = await api.post('/billing/create', { planName });
      const { confirmationUrl } = response.data;
      
      if (confirmationUrl) {
        window.top.location.href = confirmationUrl;
      } else {
        throw new Error('No confirmation URL returned from Shopify billing API');
      }
    } catch (error) {
      setErrorMsg(error.response?.data?.error || error.message);
      setUpgrading(null);
    }
  }

  if (loading) return <Loader />;

  const currentPlan = billing?.plan || 'STARTER';
  const limit = billing?.messageLimit || 500;
  const count = billing?.messageCount || 0;
  const isOverLimit = limit !== -1 && count >= limit;

  const usagePercentage = limit > 0 ? Math.min(100, Math.round((count / limit) * 100)) : 0;

  const plans = [
    {
      name: 'STARTER',
      price: '$5',
      limit: '500 messages/month',
      description: 'Ideal for new stores exploring automation.',
      features: [
        'Connect Meta account',
        'Abandoned Cart recovery',
        'Basic delivery logs',
        '500 monthly message cap',
      ]
    },
    {
      name: 'GROWTH',
      price: '$15',
      limit: '5,000 messages/month',
      description: 'Perfect for growing stores needing higher limits.',
      isPopular: true,
      features: [
        'Connect Meta account',
        'Abandoned Cart recovery',
        'Order confirmation messages',
        'Full analytics dashboard',
        '5,000 monthly message cap',
      ]
    },
    {
      name: 'PRO',
      price: '$49',
      limit: 'Unlimited messages/month',
      description: 'For power sellers seeking maximum conversions.',
      features: [
        'Connect Meta account',
        'Abandoned Cart recovery',
        'Order confirmation messages',
        'Full analytics dashboard',
        'No message sending limits',
        'Priority message queue',
      ]
    }
  ];

  return (
    <Page>
      <Layout>
        {errorMsg && (
          <Layout.Section>
            <Banner tone="critical" title="Billing Error">{errorMsg}</Banner>
          </Layout.Section>
        )}

        {isOverLimit && (
          <Layout.Section>
            <Banner
              title="Message Budget Depleted"
              tone="critical"
              action={{ content: 'Upgrade Plan', onAction: () => handlePlanSelect('GROWTH') }}
            >
              <p>Your current plan has reached its message limit ({count} / {limit}). Automated notifications have been suspended. Upgrade your plan to resume service.</p>
            </Banner>
          </Layout.Section>
        )}

        {/* 1. Subscription metrics card */}
        <Layout.Section>
          <div className="premium-card animate-fade-in">
            <div style={{ padding: '28px' }}>
              <BlockStack gap="4">
                <InlineStack align="space-between">
                  <BlockStack gap="1">
                    <Text variant="headingMd" as="h4">
                      Current Subscription Plan: <strong style={{ color: '#008060' }}>{currentPlan}</strong>
                    </Text>
                    <Text tone="subdued" variant="bodyMd">
                      {limit === -1 
                        ? 'You have unlimited messaging capacity.' 
                        : `Your plan supports up to ${limit} automated messages per billing cycle.`
                      }
                    </Text>
                  </BlockStack>
                  <BlockStack gap="1" align="end">
                    <Text variant="bodySm" tone="subdued">Billing Date</Text>
                    <Text fontWeight="bold" variant="bodyMd">
                      {billing?.billingOn ? new Date(billing.billingOn).toLocaleDateString() : 'Active Installation'}
                    </Text>
                  </BlockStack>
                </InlineStack>

                {limit !== -1 && (
                  <div style={{ marginTop: '20px' }}>
                    <BlockStack gap="2">
                      <InlineStack align="space-between">
                        <Text variant="bodySm" tone="subdued">Usage Limit Progress</Text>
                        <Text variant="bodySm" fontWeight="bold">{count} / {limit} Messages Sent</Text>
                      </InlineStack>
                      <div style={{ marginTop: '8px' }}>
                        <ProgressBar progress={usagePercentage} tone={isOverLimit ? 'critical' : 'success'} />
                      </div>
                    </BlockStack>
                  </div>
                )}
              </BlockStack>
            </div>
          </div>
        </Layout.Section>

        {/* 2. Side-by-Side plan cards grid */}
        <Layout.Section>
          <Grid>
            {plans.map((plan) => {
              const isCurrent = currentPlan === plan.name;
              const cardClass = `premium-card pricing-card ${plan.isPopular ? 'popular' : ''}`;
              
              return (
                <Grid.Cell key={plan.name} columnSpan={{ xs: 12, sm: 4, md: 4, lg: 4 }}>
                  <div className={cardClass} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {plan.isPopular && <div className="popular-badge">POPULAR</div>}
                    
                    <div style={{ padding: '28px', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                      <BlockStack gap="4">
                        <BlockStack gap="1">
                          <Text variant="headingLg" as="h4">{plan.name}</Text>
                          <Text variant="bodyXs" tone="subdued">{plan.description}</Text>
                        </BlockStack>

                        <div style={{ margin: '8px 0' }}>
                          <InlineStack align="baseline" gap="1">
                            <span className="pricing-price-accent">{plan.price}</span>
                            <Text variant="bodySm" tone="subdued">/ month</Text>
                          </InlineStack>
                        </div>
                        
                        <div style={{ borderBottom: '1px solid #f1f2f4', paddingBottom: '12px' }}>
                          <Text variant="bodySm" fontWeight="bold" tone="subdued">{plan.limit}</Text>
                        </div>
                      </BlockStack>

                      <div style={{ flexGrow: 1, margin: '16px 0' }}>
                        <ul className="feature-check-list">
                          {plan.features.map((feat, i) => (
                            <li key={i}>{feat}</li>
                          ))}
                        </ul>
                      </div>

                      <div style={{ marginTop: 'auto' }}>
                        <Button 
                          variant={plan.isPopular ? 'primary' : 'secondary'} 
                          fullWidth 
                          disabled={isCurrent} 
                          loading={upgrading === plan.name}
                          onClick={() => handlePlanSelect(plan.name)}
                          size="large"
                        >
                          {isCurrent ? 'Active Plan' : `Select ${plan.name}`}
                        </Button>
                      </div>
                    </div>
                  </div>
                </Grid.Cell>
              );
            })}
          </Grid>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
