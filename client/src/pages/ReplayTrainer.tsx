// @ts-nocheck
/**
 * Replay Trainer Page
 *
 * Bloomberg-style replay system for generating RLHF training data.
 * Shows historical trading days as if live, captures decisions + reasoning.
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HistoricalChart } from '@/components/replay/HistoricalChart';
import { OptionsChainDual } from '@/components/replay/OptionsChainDual';
import { DecisionPanel } from '@/components/replay/DecisionPanel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Play, Pause, SkipForward, Calendar, Clock, Shuffle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// API functions with error handling
async function fetchAvailableDates(symbol: string) {
  console.log(`[ReplayTrainer] Fetching dates for ${symbol}`);
  const res = await fetch(`/api/replay/dates/${symbol}`);
  if (!res.ok) {
    console.error(`[ReplayTrainer] Failed to fetch dates: ${res.status}`);
    throw new Error(`Failed to fetch dates: ${res.status}`);
  }
  const data = await res.json();
  console.log(`[ReplayTrainer] Got ${data.count || 0} dates`);
  return data;
}

async function fetchDayData(symbol: string, date: string, time?: string) {
  const url = time
    ? `/api/replay/day/${symbol}/${date}?time=${time}`
    : `/api/replay/day/${symbol}/${date}`;
  console.log(`[ReplayTrainer] Fetching day data: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[ReplayTrainer] Failed to fetch day data: ${res.status}`);
    throw new Error(`Failed to fetch day data: ${res.status}`);
  }
  const data = await res.json();
  console.log(`[ReplayTrainer] Got ${data.candles?.length || 0} candles, ${data.options?.length || 0} options`);
  return data;
}

async function fetchOutcome(symbol: string, date: string) {
  const res = await fetch(`/api/replay/outcome/${symbol}/${date}`);
  if (!res.ok) {
    console.error(`[ReplayTrainer] Failed to fetch outcome: ${res.status}`);
    throw new Error(`Failed to fetch outcome: ${res.status}`);
  }
  return res.json();
}

export default function ReplayTrainer() {
  const symbol = 'SPY';

  // State
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [currentTime, setCurrentTime] = useState('10:30');
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedStrike, setSelectedStrike] = useState<number | undefined>();
  const [selectedRight, setSelectedRight] = useState<'PUT' | 'CALL' | undefined>();
  const [decisions, setDecisions] = useState<any[]>([]);
  const [showOutcome, setShowOutcome] = useState(false);
  const [usedDates, setUsedDates] = useState<Set<string>>(new Set());

  // Fetch available dates
  const { data: datesData, isLoading: datesLoading, error: datesError } = useQuery({
    queryKey: ['replay-dates', symbol],
    queryFn: () => fetchAvailableDates(symbol),
  });

  // Get random unused date - prefer recent dates (2025+) for verification
  const getRandomDate = useCallback(() => {
    if (!datesData?.dates?.length) return null;

    const availableDates = datesData.dates.filter((d: string) => !usedDates.has(d));
    if (availableDates.length === 0) {
      // Reset if all dates used
      setUsedDates(new Set());
      // Prefer recent dates (2025+) for easier verification
      const recentDates = datesData.dates.filter((d: string) => d >= '2025-01-01');
      const pool = recentDates.length > 0 ? recentDates : datesData.dates;
      return pool[Math.floor(Math.random() * pool.length)];
    }

    // Prefer recent dates (2025+) for easier verification
    const recentAvailable = availableDates.filter((d: string) => d >= '2025-01-01');
    const pool = recentAvailable.length > 0 ? recentAvailable : availableDates;
    return pool[Math.floor(Math.random() * pool.length)];
  }, [datesData, usedDates]);

  // Set initial random date when dates load
  useEffect(() => {
    if (datesData?.dates?.length > 0 && !selectedDate) {
      const randomDate = getRandomDate();
      if (randomDate) {
        setSelectedDate(randomDate);
        setUsedDates((prev) => new Set(prev).add(randomDate));
      }
    }
  }, [datesData, selectedDate, getRandomDate]);

  // Fetch day data - updates when time changes
  const { data: dayData, isLoading: dayLoading } = useQuery({
    queryKey: ['replay-day', symbol, selectedDate, currentTime],
    queryFn: () => fetchDayData(symbol, selectedDate, currentTime),
    enabled: !!selectedDate,
    staleTime: 0, // Always refetch when time changes
  });

  // Fetch outcome (only when revealed)
  const { data: outcomeData } = useQuery({
    queryKey: ['replay-outcome', symbol, selectedDate],
    queryFn: () => fetchOutcome(symbol, selectedDate),
    enabled: !!selectedDate && showOutcome,
  });

  // Time progression simulation
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setCurrentTime((prev) => {
        const [hours, mins] = prev.split(':').map(Number);
        let newMins = mins + 5;
        let newHours = hours;

        if (newMins >= 60) {
          newMins = 0;
          newHours += 1;
        }

        if (newHours >= 16) {
          setIsPlaying(false);
          return '16:00';
        }

        return `${newHours.toString().padStart(2, '0')}:${newMins.toString().padStart(2, '0')}`;
      });
    }, 2000); // 2 seconds = 5 minutes of market time

    return () => clearInterval(interval);
  }, [isPlaying]);

  // Handle option selection
  const handleSelectOption = (option: any) => {
    setSelectedStrike(option.strike);
    setSelectedRight(option.right);
  };

  // Handle decision submission
  const handleSubmitDecision = (decision: any) => {
    const newDecision = {
      ...decision,
      date: selectedDate,
      timestamp: `${selectedDate} ${currentTime}`,
      spotPrice: dayData?.spotPrice,
      selectedStrike,
      selectedRight,
    };
    setDecisions((prev) => [...prev, newDecision]);
    setShowOutcome(true);
    setIsPlaying(false);

    console.log('Decision submitted:', newDecision);
    // TODO: Save to database via API
  };

  // Get next random day
  const handleNextRandomDay = () => {
    const randomDate = getRandomDate();
    if (randomDate) {
      setSelectedDate(randomDate);
      setUsedDates((prev) => new Set(prev).add(randomDate));
      setCurrentTime('10:30');
      setShowOutcome(false);
      setSelectedStrike(undefined);
      setSelectedRight(undefined);
    }
  };

  // Skip to 11am
  const handleSkipTo11 = () => {
    setCurrentTime('11:00');
  };

  // Loading state
  if (datesLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-3">Loading historical data...</span>
      </div>
    );
  }

  // Error state
  if (datesError || (datesData && !datesData.dates?.length)) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col items-center justify-center gap-4">
        <div className="text-red-400 text-xl">Historical Data Not Available</div>
        <div className="text-gray-400 text-sm max-w-md text-center">
          {datesError
            ? `Error: ${(datesError as Error).message}`
            : 'No historical trading data found. Data needs to be loaded into the system.'}
        </div>
        <div className="text-gray-500 text-xs mt-4">
          Expected data location: data/theta/processed/SPY/
        </div>
      </div>
    );
  }

  const spotPrice = dayData?.spotPrice ?? 0;
  const options = dayData?.options ?? [];
  const candles = dayData?.candles ?? [];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Top Bar - Controls */}
      <div className="sticky top-16 z-10 bg-[#0a0a0f] border-b border-gray-800">
        <div className="px-6 py-3 flex items-center justify-between">
          {/* Date Display */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-black/30 rounded-lg border border-gray-700">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span className="font-mono text-lg">{selectedDate || '----'}</span>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleNextRandomDay}
              disabled={showOutcome}
              className="border-gray-700"
            >
              <Shuffle className="w-4 h-4 mr-1" />
              Random Day
            </Button>

            <span className="text-xs text-gray-500">
              {usedDates.size} / {datesData?.count ?? 0} seen
            </span>
          </div>

          {/* Time & Playback */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-black/30 rounded-lg border border-gray-700">
              <Clock className="w-4 h-4 text-gray-400" />
              <span className="font-mono text-lg">{currentTime}</span>
              <span className="text-xs text-gray-500">ET</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsPlaying(!isPlaying)}
                disabled={showOutcome}
                className={cn(
                  'border-gray-700',
                  isPlaying && 'bg-green-500/20 border-green-500 text-green-400'
                )}
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 mr-1" />
                ) : (
                  <Play className="w-4 h-4 mr-1" />
                )}
                {isPlaying ? 'Pause' : 'Play'}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleSkipTo11}
                disabled={showOutcome || currentTime >= '11:00'}
                className="border-gray-700"
              >
                <SkipForward className="w-4 h-4 mr-1" />
                11am
              </Button>
            </div>
          </div>

          {/* Spot Price */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">{symbol}</span>
            {dayLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <span className="text-2xl font-mono font-bold">
                ${spotPrice.toFixed(2)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-6 py-4">
        {/* Chart Section - Historical candles */}
        <div className="mb-4 relative">
          <div className="absolute top-3 left-3 z-10 px-3 py-1.5 bg-black/70 rounded text-sm font-mono">
            {selectedDate && new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })}
          </div>
          <HistoricalChart
            candles={candles}
            height={400}
            currentTime={currentTime}
            showMA={true}
            maPeriod={20}
          />
        </div>

        {/* Bottom Section - Options Chain + Decision Panel */}
        <div className="grid grid-cols-3 gap-4">
          {/* Options Chain - Takes 2 columns */}
          <div className="col-span-2">
            {dayLoading ? (
              <div className="bg-[#111118] rounded-lg border border-gray-800 p-8 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                <span className="ml-2 text-gray-400">Loading options...</span>
              </div>
            ) : (
              <OptionsChainDual
                options={options}
                spotPrice={spotPrice}
                onSelectOption={handleSelectOption}
                selectedStrike={selectedStrike}
                selectedRight={selectedRight}
              />
            )}
          </div>

          {/* Decision Panel */}
          <div className="col-span-1">
            <DecisionPanel
              selectedStrike={selectedStrike}
              selectedRight={selectedRight}
              spotPrice={spotPrice}
              onSubmit={handleSubmitDecision}
              disabled={showOutcome}
            />

            {/* Outcome Reveal */}
            {showOutcome && outcomeData && (
              <Card className="mt-4 p-4 bg-[#111118] border-gray-800">
                <h4 className="text-sm font-semibold text-white mb-3">Day Outcome</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Open:</span>
                    <span className="font-mono text-white">
                      ${outcomeData.openPrice?.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Close:</span>
                    <span className="font-mono text-white">
                      ${outcomeData.closePrice?.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Change:</span>
                    <span className={cn(
                      'font-mono font-semibold',
                      outcomeData.changePercent > 0 ? 'text-green-400' : 'text-red-400'
                    )}>
                      {outcomeData.changePercent > 0 ? '+' : ''}{outcomeData.changePercent?.toFixed(2)}%
                    </span>
                  </div>
                  <div className="pt-2 border-t border-gray-700">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Direction:</span>
                      <span className={cn(
                        'font-semibold',
                        outcomeData.direction === 'BULLISH' ? 'text-green-400' :
                        outcomeData.direction === 'BEARISH' ? 'text-red-400' : 'text-gray-400'
                      )}>
                        {outcomeData.direction}
                      </span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-gray-400">Your call:</span>
                      <span className="text-white">
                        {decisions[decisions.length - 1]?.direction || 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>
                <Button
                  onClick={handleNextRandomDay}
                  className="w-full mt-4 bg-blue-600 hover:bg-blue-700"
                >
                  <Shuffle className="w-4 h-4 mr-2" />
                  Next Random Day
                </Button>
              </Card>
            )}
          </div>
        </div>

        {/* Session Stats */}
        <div className="mt-6 p-4 bg-[#111118] rounded-lg border border-gray-800">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-white">Session Stats</h4>
            <span className="text-xs text-gray-500">
              {decisions.length} decisions this session
            </span>
          </div>
          {decisions.length > 0 && (
            <div className="mt-3 grid grid-cols-5 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-white">{decisions.length}</p>
                <p className="text-xs text-gray-500">Total</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-400">
                  {decisions.filter(d => d.direction === 'PUT').length}
                </p>
                <p className="text-xs text-gray-500">PUTs</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-400">
                  {decisions.filter(d => d.direction === 'CALL').length}
                </p>
                <p className="text-xs text-gray-500">CALLs</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-purple-400">
                  {decisions.filter(d => d.direction === 'STRANGLE').length}
                </p>
                <p className="text-xs text-gray-500">Strangles</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-400">
                  {decisions.filter(d => d.direction === 'NO_TRADE').length}
                </p>
                <p className="text-xs text-gray-500">No Trade</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
