import React, { useState, useEffect } from 'react';
import { Page, Layout, FormLayout, TextField, Button, Banner, BlockStack, Text, InlineStack } from '@shopify/polaris';
import api from '../utils/api.js';
import Loader from '../components/Loader.jsx';

export default function WhatsAppSetup() {
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState({ connected: false });
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  async function fetchAccount() {
    try {
      const response = await api.get('/whatsapp');
      setAccount(response.data);
      if (response.data.connected) {
        setBusinessAccountId(response.data.business_account_id);
        setPhoneNumberId(response.data.phone_number_id);
        setAccessToken('••••••••••••••••••••••••••••••••');
      }
    } catch (error) {
      console.error('Error fetching WhatsApp setup details:', error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAccount();
  }, []);

  async function handleConnect(e) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const response = await api.post('/whatsapp/connect', {
        businessAccountId,
        phoneNumberId,
        accessToken,
      });
      setSuccessMsg(response.data.message);
      setAccount(response.data.data);
      setAccessToken('••••••••••••••••••••••••••••••••');
    } catch (error) {
      const errorText = error.response?.data?.error || error.message;
      setErrorMsg(errorText);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Are you sure you want to disconnect? This will stop all active automated notifications.')) return;
    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await api.post('/whatsapp/disconnect');
      setAccount({ connected: false });
      setBusinessAccountId('');
      setPhoneNumberId('');
      setAccessToken('');
      setSuccessMsg('WhatsApp account disconnected successfully.');
    } catch (error) {
      setErrorMsg(error.response?.data?.error || error.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Loader />;

  return (
    <Page>
      <Layout>
        {/* Connection Configuration Panel */}
        <Layout.Section>
          <BlockStack gap="4">
            {errorMsg && <Banner tone="critical" title="Setup Error">{errorMsg}</Banner>}
            {successMsg && <Banner tone="success" title="Success">{successMsg}</Banner>}

            {account.connected ? (
              <div className="premium-card animate-fade-in">
                <div style={{ borderBottom: '1px solid #e1e3e5', padding: '16px 20px' }}>
                  <InlineStack align="space-between">
                    <Text variant="headingMd" as="h4">Meta Connection Active</Text>
                    <div className="status-pill status-pill-success">
                      <span className="status-bullet status-bullet-connected"></span>
                      Active Sender
                    </div>
                  </InlineStack>
                </div>
                <div style={{ padding: '24px' }}>
                  <FormLayout>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '24px' }}>
                      <BlockStack gap="1">
                        <Text tone="subdued" variant="bodySm">Phone Number</Text>
                        <Text fontWeight="bold" variant="bodyMd">{account.phone_number || 'Pending sync'}</Text>
                      </BlockStack>
                      
                      <BlockStack gap="1">
                        <Text tone="subdued" variant="bodySm">Phone Number ID</Text>
                        <Text fontWeight="bold" variant="bodyMd">{account.phone_number_id}</Text>
                      </BlockStack>
                      
                      <BlockStack gap="1">
                        <Text tone="subdued" variant="bodySm">Business Account ID</Text>
                        <Text fontWeight="bold" variant="bodyMd">{account.business_account_id}</Text>
                      </BlockStack>

                      <BlockStack gap="1">
                        <Text tone="subdued" variant="bodySm">Last Validated</Text>
                        <Text fontWeight="bold" variant="bodyMd">
                          {account.last_sync_at ? new Date(account.last_sync_at).toLocaleString() : 'N/A'}
                        </Text>
                      </BlockStack>
                    </div>

                    <Button variant="primary" tone="critical" onClick={handleDisconnect} loading={submitting}>
                      Disconnect Account
                    </Button>
                  </FormLayout>
                </div>
              </div>
            ) : (
              <div className="premium-card animate-fade-in">
                <div style={{ borderBottom: '1px solid #e1e3e5', padding: '16px 20px' }}>
                  <Text variant="headingMd" as="h4">Connect WhatsApp Business Account</Text>
                </div>
                <div style={{ padding: '24px' }}>
                  <BlockStack gap="4">
                    <Text tone="subdued" variant="bodyMd">Configure your own Meta API credentials to deliver template notifications through your WhatsApp number.</Text>
                    
                    <form onSubmit={handleConnect}>
                      <FormLayout>
                        <TextField
                          label="WhatsApp Business Account ID"
                          value={businessAccountId}
                          onChange={setBusinessAccountId}
                          autoComplete="off"
                          placeholder="e.g. 102948174928472"
                          disabled={submitting}
                          helpText={
                            <span>
                              Copy this from the <strong>Meta App Dashboard &gt; WhatsApp &gt; API Setup</strong> tab. Or open the <a href="https://developers.facebook.com/" target="_blank" rel="noopener noreferrer">Meta App Console</a>.
                            </span>
                          }
                        />
                        <TextField
                          label="Phone Number ID"
                          value={phoneNumberId}
                          onChange={setPhoneNumberId}
                          autoComplete="off"
                          placeholder="e.g. 105820491847192"
                          disabled={submitting}
                          helpText={
                            <span>
                              Available inside the <strong>WhatsApp &gt; API Setup</strong> section on Meta Developers console.
                            </span>
                          }
                        />
                        <TextField
                          label="Permanent Access Token"
                          value={accessToken}
                          onChange={setAccessToken}
                          autoComplete="off"
                          type="password"
                          multiline={3}
                          placeholder="EAABw..."
                          disabled={submitting}
                          helpText={
                            <span>
                              Generate this in <strong>Meta Business Suite Settings &gt; System Users</strong>. Make sure to assign <code>whatsapp_business_messaging</code> permissions. <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started#set-up-developer-assets" target="_blank" rel="noopener noreferrer">Read setup documentation</a>.
                            </span>
                          }
                        />
                        <div style={{ marginTop: '12px' }}>
                          <Button submit variant="primary" loading={submitting} size="large">
                            Validate & Save Connection
                          </Button>
                        </div>
                      </FormLayout>
                    </form>
                  </BlockStack>
                </div>
              </div>
            )}
          </BlockStack>
        </Layout.Section>

        {/* Dynamic Timeline Integration Guide */}
        <Layout.Section variant="oneThird">
          <div className="premium-card" style={{ height: '100%' }}>
            <div style={{ borderBottom: '1px solid #e1e3e5', padding: '16px 20px' }}>
              <Text variant="headingMd" as="h4">Setup Guide</Text>
            </div>
            <div style={{ padding: '20px' }}>
              <div className="timeline">
                <div className="timeline-item active">
                  <div className="timeline-icon">1</div>
                  <div className="timeline-content">
                    <Text fontWeight="bold" variant="bodySm">Register Developer</Text>
                    <Text tone="subdued" variant="bodyXs">Sign up at <a href="https://developers.facebook.com/" target="_blank" rel="noopener noreferrer">developers.facebook.com</a></Text>
                  </div>
                </div>

                <div className="timeline-item active">
                  <div className="timeline-icon">2</div>
                  <div className="timeline-content">
                    <Text fontWeight="bold" variant="bodySm">Create App</Text>
                    <Text tone="subdued" variant="bodyXs">Create a Business App & add the WhatsApp product.</Text>
                  </div>
                </div>

                <div className="timeline-item">
                  <div className="timeline-icon">3</div>
                  <div className="timeline-content">
                    <Text fontWeight="bold" variant="bodySm">Generate Token</Text>
                    <Text tone="subdued" variant="bodyXs">Setup System User and generate Permanent Token with `whatsapp_business_messaging` permissions.</Text>
                  </div>
                </div>

                <div className="timeline-item">
                  <div className="timeline-icon">4</div>
                  <div className="timeline-content">
                    <Text fontWeight="bold" variant="bodySm">Verify Number</Text>
                    <Text tone="subdued" variant="bodyXs">Add and verify your sender phone number inside Meta API settings.</Text>
                  </div>
                </div>

                <div className="timeline-item">
                  <div className="timeline-icon">5</div>
                  <div className="timeline-content">
                    <Text fontWeight="bold" variant="bodySm">Connect & Deploy</Text>
                    <Text tone="subdued" variant="bodyXs">Copy IDs and Token, paste them here and save connection.</Text>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
