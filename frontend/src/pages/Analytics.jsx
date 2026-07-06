import React, { useState, useEffect } from 'react';
import { Page, Layout, Text, Box, BlockStack, InlineStack, Grid, IndexTable } from '@shopify/polaris';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import api from '../utils/api.js';
import Loader from '../components/Loader.jsx';

function timeAgo(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const seconds = Math.floor((new Date() - date) / 1000);
  
  let interval = Math.floor(seconds / 31536000);
  if (interval >= 1) return interval === 1 ? '1 year ago' : `${interval} years ago`;
  interval = Math.floor(seconds / 2592000);
  if (interval >= 1) return interval === 1 ? '1 month ago' : `${interval} months ago`;
  interval = Math.floor(seconds / 604800);
  if (interval >= 1) return interval === 1 ? '1 week ago' : `${interval} weeks ago`;
  interval = Math.floor(seconds / 86400);
  if (interval >= 1) return interval === 1 ? '1 day ago' : `${interval} days ago`;
  interval = Math.floor(seconds / 3600);
  if (interval >= 1) return interval === 1 ? '1 hour ago' : `${interval} hours ago`;
  interval = Math.floor(seconds / 60);
  if (interval >= 1) return interval === 1 ? '1 min ago' : `${interval} mins ago`;
  return seconds < 10 ? 'just now' : `${Math.floor(seconds)} secs ago`;
}

export default function Analytics() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [recentLogs, setRecentLogs] = useState([]);

  useEffect(() => {
    async function fetchAnalytics() {
      try {
        const response = await api.get('/analytics');
        setData(response.data);
        
        const fetchedLogs = response.data.recentLogs || [];
        const formattedLogs = fetchedLogs.map(log => ({
          ...log,
          time: timeAgo(log.time)
        }));
        setRecentLogs(formattedLogs);
      } catch (error) {
        console.error('Error loading analytics:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchAnalytics();
  }, []);

  if (loading) return <Loader />;

  const metrics = data?.metrics || {
    abandonedCarts: 0,
    recoveredCarts: 0,
    recoveryRate: 0.0,
    revenueRecovered: 0.00,
    messagesSent: 0,
    messagesDelivered: 0,
    messagesFailed: 0,
    deliveryRate: 0.0,
  };
  const weeklyData = data?.charts?.weekly || [];

  const getStatusBadge = (status) => {
    switch (status) {
      case 'READ':
        return <div className="status-pill status-pill-success"><span className="status-bullet status-bullet-connected"></span>Read</div>;
      case 'DELIVERED':
        return <div className="status-pill status-pill-success" style={{ backgroundColor: '#e8f0fe', color: '#1a73e8' }}><span className="status-bullet" style={{ backgroundColor: '#1a73e8' }}></span>Delivered</div>;
      case 'SENT':
        return <div className="status-pill" style={{ backgroundColor: '#fef7e0', color: '#b06000' }}><span className="status-bullet" style={{ backgroundColor: '#b06000' }}></span>Sent</div>;
      case 'FAILED':
        return <div className="status-pill status-pill-error"><span className="status-bullet status-bullet-disconnected"></span>Failed</div>;
      default:
        return <div className="status-pill" style={{ backgroundColor: '#f1f2f4' }}>{status}</div>;
    }
  };

  return (
    <Page>
      <Layout>
        {/* Performance breakdown overview cards */}
        <Layout.Section>
          <Grid>
            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
              <div className="premium-card metric-card" style={{ padding: '20px' }}>
                <BlockStack gap="1">
                  <Text variant="headingSm" as="h6" tone="subdued">Recovery Rate</Text>
                  <Text variant="headingXl" as="h3">{metrics.recoveryRate}%</Text>
                  <Text variant="bodyXs" tone="subdued">Industry Average: ~8%</Text>
                </BlockStack>
              </div>
            </Grid.Cell>
            
            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
              <div className="premium-card metric-card" style={{ padding: '20px' }}>
                <BlockStack gap="1">
                  <Text variant="headingSm" as="h6" tone="subdued">Delivery Success Rate</Text>
                  <Text variant="headingXl" as="h3">{metrics.deliveryRate}%</Text>
                  <Text variant="bodyXs" tone="subdued">Goal: Above 95%</Text>
                </BlockStack>
              </div>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
              <div className="premium-card metric-card" style={{ padding: '20px' }}>
                <BlockStack gap="1">
                  <Text variant="headingSm" as="h6" tone="subdued">Messages Dispatched</Text>
                  <Text variant="headingXl" as="h3">{metrics.messagesSent}</Text>
                  <Text variant="bodyXs" tone="subdued">Active billing cycle limit</Text>
                </BlockStack>
              </div>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3 }}>
              <div className="premium-card metric-card-success" style={{ padding: '20px' }}>
                <BlockStack gap="1">
                  <Text variant="headingSm" as="h6" tone="subdued">Total Revenue Saved</Text>
                  <Text variant="headingXl" as="h3" tone="success">${metrics.revenueRecovered.toFixed(2)}</Text>
                  <Text variant="bodyXs" tone="subdued">Saved through automated scans</Text>
                </BlockStack>
              </div>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        {/* Weekly performance statistics charts */}
        <Layout.Section>
          <div className="premium-card">
            <div style={{ borderBottom: '1px solid #e1e3e5', padding: '16px 20px' }}>
              <Text variant="headingMd" as="h4">Weekly Performance (Sales Recovery)</Text>
            </div>
            <div style={{ padding: '24px 20px 20px 20px', minHeight: '320px' }}>
              {weeklyData.length === 0 ? (
                <div style={{ display: 'flex', height: '240px', alignItems: 'center', justifyContent: 'center' }}>
                  <Text tone="subdued">Waiting for weekly aggregated trends...</Text>
                </div>
              ) : (
                <div style={{ width: '100%', height: '280px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weeklyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f2f4" />
                      <XAxis dataKey="week" stroke="#8c9196" fontSize={11} tickLine={false} />
                      <YAxis stroke="#8c9196" fontSize={11} tickLine={false} />
                      <Tooltip 
                        contentStyle={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #c9cccf', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                        formatter={(value) => [`$${value.toFixed(2)}`, 'Revenue']} 
                      />
                      <Legend />
                      <Bar dataKey="revenue" fill="#008060" radius={[4, 4, 0, 0]} name="Recovered Revenue ($)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </Layout.Section>

        {/* Recent messages audit logs */}
        <Layout.Section>
          <div className="premium-card">
            <div style={{ borderBottom: '1px solid #e1e3e5', padding: '16px 20px' }}>
              <BlockStack gap="1">
                <Text variant="headingMd" as="h4">Recent Automated Dispatches</Text>
                <Text tone="subdued" variant="bodySm">Inspect real-time statuses of WhatsApp notification dispatches.</Text>
              </BlockStack>
            </div>
            <div style={{ padding: '8px 0px' }}>
              <IndexTable
                resourceName={{ singular: 'log', plural: 'logs' }}
                itemCount={recentLogs.length}
                headings={[
                  { title: 'Recipient Number' },
                  { title: 'Message Type' },
                  { title: 'Dispatch Status' },
                  { title: 'Time Sent' },
                ]}
                selectable={false}
              >
                {recentLogs.map((log, index) => (
                  <IndexTable.Row id={log.id} key={log.id} position={index}>
                    <IndexTable.Cell>
                      <span style={{ fontWeight: 'bold' }}>{log.phone}</span>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{log.type}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="2" align="start">
                        {getStatusBadge(log.status)}
                        {log.error && <Text tone="critical" variant="bodySm">({log.error})</Text>}
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{log.time}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </div>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
