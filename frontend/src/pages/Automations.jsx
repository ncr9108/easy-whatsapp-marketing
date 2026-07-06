import React, { useState, useEffect } from 'react';
import { Page, Layout, FormLayout, Button, Banner, BlockStack, Text, Checkbox, Tabs, TextField, Grid } from '@shopify/polaris';
import api from '../utils/api.js';
import Loader from '../components/Loader.jsx';

export default function Automations() {
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState([]);
  const [templates, setTemplates] = useState([]);
  
  // Active states
  const [savingRules, setSavingRules] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [syncingTemplate, setSyncingTemplate] = useState(false);
  const [selectedTab, setSelectedTab] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Editor states
  const [currentBody, setCurrentBody] = useState('');
  const [currentEnabled, setCurrentEnabled] = useState(true);
  const [currentMetaName, setCurrentMetaName] = useState('');
  const [currentMetaStatus, setCurrentMetaStatus] = useState('NOT_REGISTERED');
  const [currentMetaError, setCurrentMetaError] = useState('');

  const templateTypes = ['ABANDONED_CART', 'ORDER_CONFIRMATION'];

  // Correct Polaris tab specification: title is passed as content!
  const tabList = [
    { id: 'abandoned-cart', content: 'Abandoned Cart Notification' },
    { id: 'order-confirmation', content: 'Order Confirmation Message' },
  ];

  async function fetchSettings() {
    try {
      const response = await api.get('/automation');
      const fetchedRules = response.data.rules || [];
      const fetchedTemplates = response.data.templates || [];
      
      setRules(fetchedRules);
      setTemplates(fetchedTemplates);

      // Initialize editor with first template (ABANDONED_CART)
      const initialTemplate = fetchedTemplates.find(t => t.template_type === 'ABANDONED_CART');
      if (initialTemplate) {
        setCurrentBody(initialTemplate.body_text);
        setCurrentEnabled(initialTemplate.is_enabled);
        setCurrentMetaName(initialTemplate.meta_template_name || '');
        setCurrentMetaStatus(initialTemplate.meta_status || 'NOT_REGISTERED');
        setCurrentMetaError(initialTemplate.meta_error || '');
      }
    } catch (error) {
      console.error('Error fetching automation settings:', error);
      setErrorMsg('Failed to load automation settings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSettings();
  }, []);

  // Update editor state when tab changes
  useEffect(() => {
    if (templates.length === 0) return;
    const targetType = templateTypes[selectedTab];
    const template = templates.find(t => t.template_type === targetType);
    if (template) {
      setCurrentBody(template.body_text);
      setCurrentEnabled(template.is_enabled);
      setCurrentMetaName(template.meta_template_name || '');
      setCurrentMetaStatus(template.meta_status || 'NOT_REGISTERED');
      setCurrentMetaError(template.meta_error || '');
    } else {
      setCurrentBody('');
      setCurrentEnabled(false);
      setCurrentMetaName('');
      setCurrentMetaStatus('NOT_REGISTERED');
      setCurrentMetaError('');
    }
  }, [selectedTab, templates]);

  // Handle checking delay rules checkboxes
  function handleRuleToggle(index) {
    const updatedRules = [...rules];
    updatedRules[index].is_enabled = !updatedRules[index].is_enabled;
    setRules(updatedRules);
  }

  // Save scheduler delay rules
  async function handleSaveRules() {
    setSavingRules(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const rulesPayload = rules.map(r => ({
        delayHours: r.delay_hours,
        isEnabled: r.is_enabled,
      }));
      const response = await api.post('/automation/rules', { rules: rulesPayload });
      setRules(response.data.rules);
      setSuccessMsg('Scheduler triggers updated successfully.');
    } catch (error) {
      setErrorMsg(error.response?.data?.error || error.message);
    } finally {
      setSavingRules(false);
    }
  }

  // Save current template text & resolve variables
  async function handleSaveTemplate() {
    setSavingTemplate(true);
    setErrorMsg('');
    setSuccessMsg('');
    const targetType = templateTypes[selectedTab];

    const availableVariables = [
      'customer_name', 'store_name', 'checkout_url', 
      'discount_code', 'order_number', 'order_total', 'tracking_url'
    ];
    const variablesUsed = availableVariables.filter(v => currentBody.includes(`{{${v}}}`));

    try {
      const response = await api.post('/automation/template', {
        templateType: targetType,
        bodyText: currentBody,
        variables: variablesUsed,
        isEnabled: currentEnabled,
      });

      const updatedTemplates = templates.map(t => {
        if (t.template_type === targetType) {
          return response.data.template;
        }
        return t;
      });
      setTemplates(updatedTemplates);
      
      // Update local states
      setCurrentMetaName(response.data.template.meta_template_name || '');
      setCurrentMetaStatus(response.data.template.meta_status || 'NOT_REGISTERED');
      setCurrentMetaError(response.data.template.meta_error || '');

      setSuccessMsg(`${targetType.replace('_', ' ')} template saved locally. Please sync to WhatsApp to activate it.`);
    } catch (error) {
      setErrorMsg(error.response?.data?.error || error.message);
    } finally {
      setSavingTemplate(false);
    }
  }

  // Register / Sync template with Meta
  async function handleSyncTemplate() {
    setSyncingTemplate(true);
    setErrorMsg('');
    setSuccessMsg('');
    const targetType = templateTypes[selectedTab];

    try {
      // 1. Automatically save local changes first to ensure the database has the latest text body
      const availableVariables = [
        'customer_name', 'store_name', 'checkout_url', 
        'discount_code', 'order_number', 'order_total', 'tracking_url'
      ];
      const variablesUsed = availableVariables.filter(v => currentBody.includes(`{{${v}}}`));

      const saveResponse = await api.post('/automation/template', {
        templateType: targetType,
        bodyText: currentBody,
        variables: variablesUsed,
        isEnabled: currentEnabled,
      });

      // Update local template state with the saved details
      const savedTemplate = saveResponse.data.template;
      const savedTemplates = templates.map(t => {
        if (t.template_type === targetType) {
          return savedTemplate;
        }
        return t;
      });
      setTemplates(savedTemplates);

      // 2. Send the registration API request to Meta WABA
      const response = await api.post('/automation/template/register', {
        templateType: targetType,
      });
      
      const updatedTemplate = response.data.template;
      const updatedTemplates = templates.map(t => {
        if (t.template_type === targetType) {
          return updatedTemplate;
        }
        return t;
      });
      setTemplates(updatedTemplates);
      
      // Update local states
      setCurrentMetaName(updatedTemplate.meta_template_name);
      setCurrentMetaStatus(updatedTemplate.meta_status);
      setCurrentMetaError(updatedTemplate.meta_error || '');
      
      setSuccessMsg(`Template sync request submitted to Meta as "${updatedTemplate.meta_template_name}". Review status may take a few minutes.`);
    } catch (error) {
      const errorText = error.response?.data?.error || error.message;
      setErrorMsg(`Meta sync failed: ${errorText}`);
      
      if (error.response?.data?.template) {
        const updatedTemplate = error.response.data.template;
        const updatedTemplates = templates.map(t => {
          if (t.template_type === targetType) {
            return updatedTemplate;
          }
          return t;
        });
        setTemplates(updatedTemplates);
        setCurrentMetaName(updatedTemplate.meta_template_name || '');
        setCurrentMetaStatus(updatedTemplate.meta_status);
        setCurrentMetaError(updatedTemplate.meta_error || errorText);
      } else {
        setCurrentMetaStatus('FAILED');
        setCurrentMetaError(errorText);
      }
    } finally {
      setSyncingTemplate(false);
    }
  }

  // Translate variable names into sequential {{1}}, {{2}} placeholders for manual Meta registration
  function getManualBodyText() {
    let body = currentBody;
    const availableVariables = [
      'customer_name', 'store_name', 'checkout_url', 
      'discount_code', 'order_number', 'order_total', 'tracking_url'
    ];
    
    // Find variables in order of appearance
    const variablesInOrder = [];
    const regex = /\{\{([^}]+)\}\}/g;
    let match;
    while ((match = regex.exec(currentBody)) !== null) {
      const varName = match[1];
      if (availableVariables.includes(varName) && !variablesInOrder.includes(varName)) {
        variablesInOrder.push(varName);
      }
    }
    
    // Replace sequentially
    variablesInOrder.forEach((v, index) => {
      body = body.replaceAll(`{{${v}}}`, `{{${index + 1}}}`);
    });
    
    // Apply safety prefix/suffix to match backend registration filters
    let bodyTrimmed = body.trim();
    if (bodyTrimmed.startsWith("{{")) {
      bodyTrimmed = "Hello " + bodyTrimmed;
    }
    if (bodyTrimmed.endsWith("}}")) {
      const targetType = templateTypes[selectedTab];
      if (targetType === 'ABANDONED_CART') {
        bodyTrimmed = bodyTrimmed + ". Happy Shopping!";
      } else {
        bodyTrimmed = bodyTrimmed + ". Thank you!";
      }
    }
    
    return bodyTrimmed;
  }

  // Render a compact status badge for the template status header
  function renderCompactStatusBadge() {
    let color = '#5c5f62';
    let bg = '#f1f2f4';
    let text = 'Draft (Unsynced)';
    
    const statusUpper = (currentMetaStatus || '').toUpperCase();
    if (statusUpper === 'APPROVED' || statusUpper === 'ACTIVE') {
      color = '#008060';
      bg = '#e7f4e4';
      text = 'Approved & Active';
    } else if (statusUpper === 'PENDING' || statusUpper === 'IN_REVIEW') {
      color = '#9c5700';
      bg = '#fff5ea';
      text = 'In Review';
    } else if (statusUpper === 'REJECTED') {
      color = '#bf0711';
      bg = '#fbeae5';
      text = 'Rejected by Meta';
    } else if (statusUpper === 'FAILED') {
      color = '#bf0711';
      bg = '#fbeae5';
      text = 'Sync Failed';
    }
    
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '6px 12px',
        borderRadius: '16px',
        fontSize: '13px',
        fontWeight: '600',
        color: color,
        backgroundColor: bg,
        border: `1px solid ${color}33`,
      }}>
        <span style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: color,
          marginRight: '8px',
          display: 'inline-block'
        }}></span>
        {text}
      </span>
    );
  }

  // Render the current sync status banner with contextual Meta details (only for warnings/failures)
  function renderSyncStatusBanner() {
    const statusUpper = (currentMetaStatus || '').toUpperCase();
    switch (statusUpper) {
      case 'REJECTED':
        return (
          <Banner tone="critical" title="Template Rejected by Meta">
            <p>Meta rejected <code>{currentMetaName}</code>. Reason/Error: <strong>{currentMetaError}</strong>. Please modify the text body and try syncing again.</p>
          </Banner>
        );
      case 'FAILED':
        return (
          <Banner tone="critical" title="Meta Template Registration Failed">
            <p>Could not register template. Error: <strong>{currentMetaError}</strong>. Ensure your token has <code>whatsapp_business_management</code> permission or refer to the manual setup guide below.</p>
          </Banner>
        );
      case 'APPROVED':
      case 'ACTIVE':
      case 'PENDING':
      case 'IN_REVIEW':
      case 'NOT_REGISTERED':
      default:
        return null; // Handled cleanly by inline header badge
    }
  }

  // Simulator helper to render mock values instead of tags
  const renderSimulatedPreview = (text) => {
    if (!text) return 'Write some text...';
    return text
      .replace(/\{\{customer_name\}\}/g, 'John Doe')
      .replace(/\{\{store_name\}\}/g, 'PremiumStore')
      .replace(/\{\{checkout_url\}\}/g, 'https://store.myshopify.com/checkouts/123/ac')
      .replace(/\{\{discount_code\}\}/g, 'WELCOME10')
      .replace(/\{\{order_number\}\}/g, '#18472')
      .replace(/\{\{order_total\}\}/g, '$120.00')
      .replace(/\{\{tracking_url\}\}/g, 'https://track.package/1a2b3c');
  };

  if (loading) return <Loader />;

  return (
    <Page>
      <Layout>
        {/* Alerts and Banner notices */}
        {(errorMsg || successMsg) && (
          <Layout.Section>
            {errorMsg && <Banner tone="critical" title="Error">{errorMsg}</Banner>}
            {successMsg && <Banner tone="success" title="Settings Saved">{successMsg}</Banner>}
          </Layout.Section>
        )}

        {/* 1. Scheduler delays checklist */}
        <Layout.Section>
          <div className="premium-card animate-fade-in">
            <div style={{ borderBottom: '1px solid #e1e3e5', padding: '16px 20px' }}>
              <Text variant="headingMd" as="h4">Recovery Automation Rules</Text>
            </div>
            <div style={{ padding: '24px' }}>
              <BlockStack gap="4">
                <Text tone="subdued" variant="bodyMd">Choose the delay intervals to run recovery messages. The scheduler will check automatically every 5 minutes.</Text>
                
                <FormLayout>
                  <div className="delay-checkboxes-group">
                    {rules.map((rule, idx) => (
                      <Checkbox
                        key={rule.id}
                        label={`Send after ${rule.delay_hours} hours`}
                        checked={rule.is_enabled}
                        onChange={() => handleRuleToggle(idx)}
                      />
                    ))}
                  </div>

                  <div style={{ marginTop: '16px' }}>
                    <Button variant="primary" onClick={handleSaveRules} loading={savingRules}>
                      Save Scheduler Rules
                    </Button>
                  </div>
                </FormLayout>
              </BlockStack>
            </div>
          </div>
        </Layout.Section>

        {/* 2. Message Template Builder with live phone simulator */}
        <Layout.Section>
          <div className="premium-card animate-fade-in">
            <Tabs tabs={tabList} selected={selectedTab} onSelect={setSelectedTab} />
            <div style={{ padding: '24px', borderTop: '1px solid #e1e3e5' }}>
              <Grid>
                {/* Form fields */}
                <Grid.Cell columnSpan={{ xs: 12, sm: 7, md: 7, lg: 7 }}>
                  <BlockStack gap="5">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', borderBottom: '1px solid #e1e3e5', paddingBottom: '16px', marginBottom: '8px' }}>
                      <Checkbox
                        label="Enable this template trigger"
                        checked={currentEnabled}
                        onChange={setCurrentEnabled}
                      />
                      {renderCompactStatusBadge()}
                    </div>

                    {/* Meta Sync Status Banner */}
                    {renderSyncStatusBanner()}
                    
                    <TextField
                      label="Message Text Body"
                      value={currentBody}
                      onChange={setCurrentBody}
                      multiline={7}
                      autoComplete="off"
                      helpText="Use double braces to inject dynamic merchant attributes e.g. {{customer_name}}, {{checkout_url}}, {{store_name}}, {{order_number}}, {{order_total}}, {{tracking_url}}"
                    />

                    {/* Clean action buttons with clear priority */}
                    <div style={{ marginTop: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <Button 
                        variant="primary" 
                        onClick={handleSyncTemplate} 
                        loading={syncingTemplate} 
                        size="large"
                        disabled={savingTemplate}
                      >
                        Sync to WhatsApp (Meta)
                      </Button>
                      
                      <Button 
                        variant="secondary" 
                        onClick={handleSaveTemplate} 
                        loading={savingTemplate} 
                        size="large"
                        disabled={syncingTemplate}
                      >
                        Save Local Draft
                      </Button>
                    </div>

                    {/* Collapsible Manual Registration Guide */}
                    <div style={{ marginTop: '24px', borderTop: '1px solid #e1e3e5', paddingTop: '20px' }}>
                      <details style={{ width: '100%' }}>
                        <summary style={{ 
                          cursor: 'pointer', 
                          fontWeight: '600', 
                          color: '#2c6ecb', 
                          fontSize: '14px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          userSelect: 'none'
                        }}>
                          🔧 Need to register manually on Meta instead? (Alternative fallback)
                        </summary>
                        
                        <div style={{ marginTop: '16px' }}>
                          <p style={{ color: '#6d7175', fontSize: '13px', marginBottom: '12px' }}>
                            If automatic sync fails due to access token permissions, you can create the template manually in Meta Business Suite:
                          </p>
                          
                          <div className="manual-guide-box" style={{ background: '#f6f6f7', padding: '16px', borderRadius: '8px', border: '1px solid #e1e3e5' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '8px', fontSize: '13px' }}>
                              <span style={{ fontWeight: 'bold' }}>Template Name:</span>
                              <code>{currentMetaName || `${templateTypes[selectedTab].toLowerCase()}_v1`}</code>
                              
                              <span style={{ fontWeight: 'bold' }}>Category:</span>
                              <span>Utility</span>
                              
                              <span style={{ fontWeight: 'bold' }}>Language:</span>
                              <span>English (US)</span>
                            </div>
                            
                            <div style={{ marginTop: '12px' }}>
                              <span style={{ fontWeight: 'bold', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Copy-Paste Template Body:</span>
                              <TextField
                                value={getManualBodyText()}
                                readOnly
                                multiline={4}
                                selectTextOnFocus
                                autoComplete="off"
                              />
                            </div>
                          </div>
                        </div>
                      </details>
                    </div>
                  </BlockStack>
                </Grid.Cell>

                {/* Simulator Area */}
                <Grid.Cell columnSpan={{ xs: 12, sm: 5, md: 5, lg: 5 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '10px 0' }}>
                    <div style={{ marginBottom: '16px' }}>
                      <Text variant="headingSm" as="h5" tone="subdued">WhatsApp Live Preview</Text>
                    </div>
                    
                    {/* High-Fidelity iPhone Frame Simulator */}
                    <div className="phone-mockup">
                      <div className="phone-dynamic-island"></div>
                      <div className="phone-screen">
                        <div className="phone-header">
                          <div className="phone-avatar">WA</div>
                          <div className="phone-contact-info">
                            <span className="phone-contact-name">Sender Notification</span>
                            <span className="phone-contact-status">online</span>
                          </div>
                          <div className="phone-header-icons">
                            {/* Video Call Icon */}
                            <svg viewBox="0 0 24 24">
                              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                            </svg>
                            {/* Call Icon */}
                            <svg viewBox="0 0 24 24">
                              <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.045 15.045 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1A11.36 11.36 0 018.82 4c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.62c0-.55-.45-1-.99-1z"/>
                            </svg>
                            {/* Menu Icon */}
                            <svg viewBox="0 0 24 24">
                              <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                            </svg>
                          </div>
                        </div>
                        
                        <div className="phone-chat-area">
                          <div className="whatsapp-bubble-sent">
                            <div style={{ whiteSpace: 'pre-wrap' }}>
                              {renderSimulatedPreview(currentBody)}
                            </div>
                            <span className="whatsapp-bubble-meta">
                              <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              <span className="whatsapp-double-tick">
                                <svg viewBox="0 0 16 12" width="14" height="10" fill="currentColor">
                                  <path d="M15 2.5L7.5 10l-4-4 1.5-1.5L7.5 7l6-6L15 2.5zm-5 0l-1.5-1.5-6 6L1 5.5.004 6.5l3.5 3.5 6.5-7.5z"/>
                                </svg>
                              </span>
                            </span>
                          </div>
                        </div>

                        <div className="phone-footer-input">
                          <div className="phone-input-container">
                            <span className="phone-input-icon">
                              {/* Smiley icon */}
                              <svg viewBox="0 0 24 24" width="14" height="14" fill="#8696a0">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/>
                              </svg>
                            </span>
                            <span className="phone-input-text">Type a message</span>
                          </div>
                          <button className="phone-send-btn">
                            {/* Send arrow icon */}
                            <svg viewBox="0 0 24 24" width="10" height="10" fill="white">
                              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </Grid.Cell>
              </Grid>
            </div>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
