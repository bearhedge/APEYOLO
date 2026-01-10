/**
 * DD Page - Live / Train / Research
 *
 * Unified page for market analysis with three modes:
 * - Live: Real-time market monitoring + data capture
 * - Train: Realistic replay training with fixed time windows
 * - Research: Pattern mining with timestamp jumping
 */

import { useState } from 'react';
import { LeftNav } from '@/components/LeftNav';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrainTab } from '@/components/dd/TrainTab';
import { ResearchTab } from '@/components/dd/ResearchTab';
import { LiveTab } from '@/components/dd/LiveTab';

export function DD() {
  const [activeTab, setActiveTab] = useState<'live' | 'train' | 'research'>('train');

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 overflow-hidden flex flex-col bg-[#0a0a0f]">
        {/* Tab Navigation */}
        <div className="border-b border-white/10 px-6 py-2">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'live' | 'train' | 'research')}>
            <TabsList className="bg-transparent">
              <TabsTrigger
                value="live"
                className="data-[state=active]:bg-white data-[state=active]:text-black"
              >
                Live
              </TabsTrigger>
              <TabsTrigger
                value="train"
                className="data-[state=active]:bg-white data-[state=active]:text-black"
              >
                Train
              </TabsTrigger>
              <TabsTrigger
                value="research"
                className="data-[state=active]:bg-white data-[state=active]:text-black"
              >
                Research
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'live' && <LiveTab />}
          {activeTab === 'train' && <TrainTab />}
          {activeTab === 'research' && <ResearchTab />}
        </div>
      </div>
    </div>
  );
}
