import React, { useState } from 'react';
import { Frame, Navigation } from '@shopify/polaris';
import { 
  HomeIcon, 
  SettingsIcon, 
  CalendarIcon, 
  CreditCardIcon, 
  ChartLineIcon 
} from '@shopify/polaris-icons';

import Dashboard from './pages/Dashboard.jsx';
import WhatsAppSetup from './pages/WhatsAppSetup.jsx';
import Automations from './pages/Automations.jsx';
import Analytics from './pages/Analytics.jsx';
import Billing from './pages/Billing.jsx';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');

  // Sidebar navigation mapping using Shopify Polaris design patterns
  const navigationMarkup = (
    <Navigation location="/">
      <Navigation.Section
        title="EasyWhatsAppMarketing"
        items={[
          {
            label: 'Dashboard',
            icon: HomeIcon,
            selected: activeTab === 'dashboard',
            onClick: () => setActiveTab('dashboard'),
          },
          {
            label: 'WhatsApp Setup',
            icon: SettingsIcon,
            selected: activeTab === 'setup',
            onClick: () => setActiveTab('setup'),
          },
          {
            label: 'Automations',
            icon: CalendarIcon,
            selected: activeTab === 'automations',
            onClick: () => setActiveTab('automations'),
          },
          {
            label: 'Analytics',
            icon: ChartLineIcon,
            selected: activeTab === 'analytics',
            onClick: () => setActiveTab('analytics'),
          },
          {
            label: 'Billing Plans',
            icon: CreditCardIcon,
            selected: activeTab === 'billing',
            onClick: () => setActiveTab('billing'),
          },
        ]}
      />
    </Navigation>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard setActiveTab={setActiveTab} />;
      case 'setup':
        return <WhatsAppSetup />;
      case 'automations':
        return <Automations />;
      case 'analytics':
        return <Analytics />;
      case 'billing':
        return <Billing />;
      default:
        return <Dashboard setActiveTab={setActiveTab} />;
    }
  };

  return (
    <Frame navigation={navigationMarkup}>
      {/* Transitions are styled in index.css */}
      <div key={activeTab} className="animate-fade-in" style={{ paddingBottom: '40px' }}>
        {renderContent()}
      </div>
    </Frame>
  );
}
