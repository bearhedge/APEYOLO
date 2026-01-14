import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { LeftNav } from '@/components/LeftNav';
import { Log } from './Log';
import { TrackRecord } from './TrackRecord';
import { Portfolio } from './Portfolio';
import { Jobs } from './Jobs';
import { Settings } from './Settings';
import type { AttestationPeriod } from '@shared/types/defi';

type TabId = 'log' | 'track-record' | 'portfolio' | 'jobs' | 'settings';

interface AdminProps {
  hideLeftNav?: boolean;
}

export function Admin({ hideLeftNav = false }: AdminProps) {
  const [location, setLocation] = useLocation();

  // Parse tab from query param (?tab=log)
  const getActiveTabFromUrl = (): TabId => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab') as TabId;
    // Validate tab exists
    const validTabs: TabId[] = ['log', 'track-record', 'portfolio', 'jobs', 'settings'];
    if (tabParam && validTabs.includes(tabParam)) {
      return tabParam;
    }
    return 'log'; // Default tab
  };

  const [activeTab, setActiveTab] = useState<TabId>(getActiveTabFromUrl);

  // Update URL when tab changes (without triggering navigation)
  useEffect(() => {
    const currentTab = getActiveTabFromUrl();
    if (currentTab !== activeTab) {
      const newUrl = `/admin?tab=${activeTab}`;
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

  // Fetch DeFi data (performance, trades, mandate, attestations)
  const { data: performanceData } = useQuery({
    queryKey: ['defi-performance'],
    queryFn: async () => {
      const res = await fetch('/api/defi/performance', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch performance');
      return res.json();
    },
    refetchInterval: 60000, // 60s
  });

  const { data: trades = [] } = useQuery({
    queryKey: ['defi-trades'],
    queryFn: async () => {
      const res = await fetch('/api/defi/trades', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch trades');
      return res.json();
    },
    refetchInterval: 60000,
  });

  const [mandate, setMandate] = useState<any>(null);
  const [mandateLoading, setMandateLoading] = useState(true);

  useEffect(() => {
    const fetchMandate = async () => {
      try {
        const res = await fetch('/api/defi/mandate', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setMandate(data.mandate || null);
        }
      } catch (err) {
        console.error('Failed to fetch mandate:', err);
      } finally {
        setMandateLoading(false);
      }
    };
    fetchMandate();
  }, []);

  // Attestation state
  const [selectedPeriod, setSelectedPeriod] = useState<AttestationPeriod>('last_week');
  const [previewData, setPreviewData] = useState<any>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const handlePreview = async () => {
    setIsPreviewLoading(true);
    try {
      const res = await fetch('/api/defi/generate-attestation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ period: selectedPeriod }),
      });
      if (!res.ok) throw new Error('Failed to generate preview');
      const data = await res.json();
      setPreviewData(data);
    } catch (err) {
      console.error('Preview error:', err);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleAttest = async () => {
    // TODO: Implement attestation logic
    console.log('Attest:', selectedPeriod, previewData);
  };

  // Build period rows for Period Summary
  const periodRows = performanceData
    ? [
        { period: 'MTD', ...performanceData.mtd, onChain: false },
        { period: 'YTD', ...performanceData.ytd, onChain: false },
        { period: 'ALL', ...performanceData.all, onChain: false },
      ]
    : [];

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {!hideLeftNav && <LeftNav />}

      <div className="flex-1 flex flex-col">
        {/* Tab Bar */}
        <div className="flex border-b border-white/10 bg-dark-gray/50 px-6">
          {(['log', 'track-record', 'portfolio', 'jobs', 'settings'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-4 text-sm font-medium transition-colors capitalize ${
                activeTab === tab
                  ? 'text-white border-b-2 border-bloomberg-blue'
                  : 'text-silver hover:text-white'
              }`}
            >
              {tab.replace('-', ' ')}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'log' && (
            <Log
              hideLeftNav={true}
              periodSummaryRows={periodRows}
              trades={trades}
              cluster="devnet"
              loading={false}
              onAttest={handleAttest}
            />
          )}
          {activeTab === 'track-record' && <TrackRecord hideLeftNav={true} />}
          {activeTab === 'portfolio' && <Portfolio hideLeftNav={true} />}
          {activeTab === 'jobs' && <Jobs hideLeftNav={true} />}
          {activeTab === 'settings' && (
            <Settings
              hideLeftNav={true}
              selectedPeriod={selectedPeriod}
              onPeriodChange={setSelectedPeriod}
              previewData={previewData}
              onPreview={handlePreview}
              onAttest={handleAttest}
              isPreviewLoading={isPreviewLoading}
              mandate={mandate}
              violationCount={0}
              mandateLoading={mandateLoading}
              attestations={[]}
              cluster="devnet"
              sasReady={false}
              checkingSas={false}
              sasError={null}
            />
          )}
        </div>
      </div>
    </div>
  );
}
