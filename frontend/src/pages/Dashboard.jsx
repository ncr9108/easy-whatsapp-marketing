import React, { useState, useEffect } from 'react';
import { Page, Layout, Card, Grid, Text, Button, Badge, Banner, Box, InlineStack, BlockStack } from '@shopify/polaris';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import api from '../utils/api.js';
import Loader from '../components/Loader.jsx';

export default function Dashboard({ setActiveTab }) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [whatsapp, setWhatsapp] = useState({ connected: false });

  useEffect(() => {
    async function fetchData() {
      console.log('[Dashboard useEffect] Starting data fetch operations...');
      try {
        const [analyticsRes, whatsappRes] = await Promise.all([
          api.get('/analytics'),
          api.get('/whatsapp')
        ]);
        setStats(analyticsRes.data);
        setWhatsapp(whatsappRes.data);
      } catch (error) {
        console.error('[Dashboard useEffect] API fetch caught error:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return <Loader />;
  }

  const metrics = stats?.metrics || {
    abandonedCarts: 0,
    recoveredCarts: 0,
    recoveryRate: 0.0,
    revenueRecovered: 0.00,
    messagesSent: 0,
    messagesDelivered: 0,
    messagesFailed: 0,
    deliveryRate: 0.0,
  };

  const chartData = stats?.charts?.daily || [];

  return (
    <Page>
      <Layout>
        {/* Banner if disconnected */}
        {!whatsapp.connected && (
          <Layout.Section>
            <div style={{ marginBottom: '16px' }}>
              <Banner
                title="WhatsApp Account Disconnected"
                tone="warning"
                action={{ content: 'Connect Account', onAction: () => setActiveTab('setup') }}
              >
                <p>Automations are currently suspended because your Meta WhatsApp Business account is not connected. Connect your account now to start recovering sales.</p>
              </Banner>
            </div>
          </Layout.Section>
        )}

        {/* 4 Metrics cards inside custom styling grids */}
        <Layout.Section>
          <Grid>
            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
              <div className="premium-card metric-card" style={{ padding: '20px' }}>
                <BlockStack gap="2">
                  <Text variant="headingSm" as="h6" tone="subdued">Abandoned Carts</Text>
                  <Text variant="headingXl" as="h3">{metrics.abandonedCarts}</Text>
                  <Text variant="bodyXs" tone="subdued">Total checkouts captured</Text>
                </BlockStack>
              </div>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
              <div className="premium-card metric-card-success" style={{ padding: '20px' }}>
                <BlockStack gap="2">
                  <Text variant="headingSm" as="h6" tone="subdued">Recovered Carts</Text>
                  <Text variant="headingXl" as="h3" tone="success">{metrics.recoveredCarts}</Text>
                  <Text variant="bodyXs" tone="subdued">Sales recovered successfully</Text>
                </BlockStack>
              </div>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
              <div className="premium-card metric-card" style={{ padding: '20px' }}>
                <BlockStack gap="2">
                  <Text variant="headingSm" as="h6" tone="subdued">Recovery Rate</Text>
                  <Text variant="headingXl" as="h3" tone="success">{metrics.recoveryRate}%</Text>
                  <Text variant="bodyXs" tone="subdued">Conversion rate benchmark</Text>
                </BlockStack>
              </div>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
              <div className="premium-card metric-card-success" style={{ padding: '20px' }}>
                <BlockStack gap="2">
                  <Text variant="headingSm" as="h6" tone="subdued">Revenue Recovered</Text>
                  <Text variant="headingXl" as="h3" tone="success">${metrics.revenueRecovered.toFixed(2)}</Text>
                  <Text variant="bodyXs" tone="subdued">Total sales value recovered</Text>
                </BlockStack>
              </div>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        {/* Dashboard detail charts and quick actions */}
        <Layout.Section>
          <Grid>
            {/* Chart Area */}
            <Grid.Cell columnSpan={{ xs: 12, sm: 8, md: 8, lg: 8 }}>
              <div className="premium-card" style={{ height: '100%' }}>
                <div style={{ borderBottom: '1px solid #e1e3e5', padding: '16px 20px' }}>
                  <Text variant="headingMd" as="h4">Revenue Recovered ($)</Text>
                </div>
                <div style={{ padding: '24px 20px 20px 20px', minHeight: '300px' }}>
                  {chartData.length === 0 ? (
                    <div style={{ display: 'flex', height: '240px', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '8px' }}>
                      <Text tone="subdued" variant="bodyMd">No sales recovery data recorded yet.</Text>
                      <Text tone="subdued" variant="bodySm">Automated recovery messages will appear here once triggers fire.</Text>
                    </div>
                  ) : (
                    <div style={{ width: '100%', height: '260px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#008060" stopOpacity={0.4}/>
                              <stop offset="95%" stopColor="#008060" stopOpacity={0.0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f2f4" />
                          <XAxis dataKey="date" stroke="#8c9196" fontSize={11} tickLine={false} />
                          <YAxis stroke="#8c9196" fontSize={11} tickLine={false} />
                          <Tooltip 
                            contentStyle={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #c9cccf', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} 
                            formatter={(value) => [`$${value.toFixed(2)}`, 'Revenue']} 
                          />
                          <Area type="monotone" dataKey="revenue" stroke="#008060" strokeWidth={2.5} fillOpacity={1} fill="url(#colorRevenue)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>
            </Grid.Cell>

            {/* Quick stats & action list */}
            <Grid.Cell columnSpan={{ xs: 12, sm: 4, md: 4, lg: 4 }}>
              <div className="premium-card" style={{ height: '100%' }}>
                <div style={{ borderBottom: '1px solid #e1e3e5', padding: '16px 20px' }}>
                  <Text variant="headingMd" as="h4">WhatsApp Dispatch Metrics</Text>
                </div>
                <div style={{ padding: '20px' }}>
                  <BlockStack gap="4">
                    <div style={{ borderBottom: '1px solid #f1f2f4', paddingBottom: '12px' }}>
                      <InlineStack align="space-between">
                        <Text tone="subdued">Status</Text>
                        {whatsapp.connected ? (
                          <div className="status-pill status-pill-success">
                            <span className="status-bullet status-bullet-connected"></span>
                            Connected
                          </div>
                        ) : (
                          <div className="status-pill status-pill-error">
                            <span className="status-bullet status-bullet-disconnected"></span>
                            Disconnected
                          </div>
                        )}
                      </InlineStack>
                    </div>

                    <div style={{ borderBottom: '1px solid #f1f2f4', paddingBottom: '12px' }}>
                      <InlineStack align="space-between">
                        <Text tone="subdued">Messages Sent</Text>
                        <Text fontWeight="bold" variant="bodyMd">{metrics.messagesSent}</Text>
                      </InlineStack>
                    </div>

                    <div style={{ borderBottom: '1px solid #f1f2f4', paddingBottom: '12px' }}>
                      <InlineStack align="space-between">
                        <Text tone="subdued">Delivered</Text>
                        <Text fontWeight="bold" variant="bodyMd">{metrics.messagesDelivered}</Text>
                      </InlineStack>
                    </div>

                    <div style={{ borderBottom: '1px solid #f1f2f4', paddingBottom: '12px' }}>
                      <InlineStack align="space-between">
                        <Text tone="subdued">Delivery Rate</Text>
                        <Text fontWeight="bold" variant="bodyMd">{metrics.deliveryRate}%</Text>
                      </InlineStack>
                    </div>

                    <div style={{ paddingBottom: '8px' }}>
                      <InlineStack align="space-between">
                        <Text tone="subdued">Failed Sends</Text>
                        <Text tone={metrics.messagesFailed > 0 ? 'critical' : 'subdued'} fontWeight="bold" variant="bodyMd">
                          {metrics.messagesFailed}
                        </Text>
                      </InlineStack>
                    </div>

                    <Button variant="primary" fullWidth onClick={() => setActiveTab('automations')}>
                      Manage Automations
                    </Button>
                  </BlockStack>
                </div>
              </div>
            </Grid.Cell>
          </Grid>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
