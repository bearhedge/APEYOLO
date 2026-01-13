/**
 * Review Page - Unified analysis interface
 *
 * Combines Track Record + Portfolio + Settings into tabbed interface.
 * Replaces /track-record, /portfolio, and /settings routes.
 */

import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { LeftNav } from '@/components/LeftNav';
import { TrackRecord } from '@/pages/TrackRecord';
import { Portfolio } from '@/pages/Portfolio';
import { Settings } from '@/pages/Settings';
import { Jobs } from '@/pages/Jobs';

type TabId = 'track-record' | 'portfolio' | 'settings' | 'jobs';

interface TabConfig {
  id: TabId;
  label: string;
  component: React.ComponentType;
}

const TABS: TabConfig[] = [
  { id: 'track-record', label: 'Track Record', component: TrackRecord },
  { id: 'portfolio', label: 'Portfolio', component: Portfolio },
  { id: 'jobs', label: 'Jobs', component: Jobs },
  { id: 'settings', label: 'Settings', component: Settings },
];

export function Review() {
  const [location, setLocation] = useLocation();

  // Parse tab from query param (?tab=track-record)
  const getActiveTabFromUrl = (): TabId => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab') as TabId;
    // Validate tab exists
    if (tabParam && TABS.some(t => t.id === tabParam)) {
      return tabParam;
    }
    return 'track-record'; // Default tab
  };

  const [activeTab, setActiveTab] = useState<TabId>(getActiveTabFromUrl);

  // Update URL when tab changes (without triggering navigation)
  useEffect(() => {
    const currentTab = getActiveTabFromUrl();
    if (currentTab !== activeTab) {
      const newUrl = `/review?tab=${activeTab}`;
      window.history.replaceState({}, '', newUrl);
    }
  }, [activeTab]);

  // Listen for URL changes (back/forward buttons)
  useEffect(() => {
    const handlePopState = () => {
      setActiveTab(getActiveTabFromUrl());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleTabClick = (tabId: TabId) => {
    setActiveTab(tabId);
    // Update URL
    const newUrl = `/review?tab=${tabId}`;
    window.history.pushState({}, '', newUrl);
  };

  // Render active tab with hideLeftNav prop
  const renderActiveTab = () => {
    const props = { hideLeftNav: true };
    switch (activeTab) {
      case 'track-record':
        return <TrackRecord {...props} />;
      case 'portfolio':
        return <Portfolio {...props} />;
      case 'jobs':
        return <Jobs {...props} />;
      case 'settings':
        return <Settings {...props} />;
      default:
        return <TrackRecord {...props} />;
    }
  };

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Left Navigation */}
      <LeftNav />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab Bar */}
        <div className="border-b border-white/10 bg-charcoal">
          <div className="flex items-center gap-1 px-6 py-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-black text-white border-b-2 border-electric'
                    : 'text-silver hover:text-white hover:bg-white/5'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content (full-width, scrollable) */}
        <div className="flex-1 overflow-hidden">
          {renderActiveTab()}
        </div>
      </div>
    </div>
  );
}
