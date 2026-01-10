import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { HistoricalChart } from '@/components/replay/HistoricalChart';
import { OptionsChainDual } from '@/components/replay/OptionsChainDual';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Calendar, Clock, Shuffle, ChevronRight, Lock, CheckCircle } from 'lucide-react';

type TimeWindow = 'window1' | 'window2' | 'window3';
type Direction = 'PUT' | 'CALL' | 'STRANGLE' | 'NO_TRADE';

interface TrainTabProps {
  symbol?: string;
}

interface WindowDecision {
  direction: Direction;
  reasoning: string;
  spotPrice: number;
}

// Time windows
const WINDOWS = {
  window1: { label: 'First 90 min', start: '09:30', end: '11:00', number: 1 },
  window2: { label: 'Next 90 min', start: '11:00', end: '12:30', number: 2 },
  window3: { label: 'Rest of day', start: '12:30', end: '16:00', number: 3 },
};

async function fetchDates(symbol: string) {
  const res = await fetch(`/api/replay/dates/${symbol}`);
  if (!res.ok) throw new Error('Failed to fetch dates');
  return res.json();
}

async function fetchMultiDayData(symbol: string, date: string, time?: string) {
  const url = time
    ? `/api/replay/multi-day/${symbol}/${date}?context=3&time=${time}`
    : `/api/replay/multi-day/${symbol}/${date}?context=3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch data');
  return res.json();
}

async function fetchOptions(symbol: string, date: string, time?: string) {
  const url = time
    ? `/api/replay/options/${symbol}/${date}?time=${time}`
    : `/api/replay/options/${symbol}/${date}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch options');
  return res.json();
}

async function saveTrainDecision(data: {
  symbol: string;
  date: string;
  windowNumber: number;
  direction: string;
  reasoning: string;
  spotPriceAtDecision: number;
}) {
  const res = await fetch('/api/dd/train-decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to save decision');
  return res.json();
}

export function TrainTab({ symbol = 'SPY' }: TrainTabProps) {
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [currentWindow, setCurrentWindow] = useState<TimeWindow>('window1');
  const [decision, setDecision] = useState<Direction | null>(null);
  const [reasoning, setReasoning] = useState('');
  const [usedDates, setUsedDates] = useState<Set<string>>(new Set());
  // Track decisions for each window in current day
  const [windowDecisions, setWindowDecisions] = useState<Record<TimeWindow, WindowDecision | null>>({
    window1: null,
    window2: null,
    window3: null,
  });

  // Fetch available dates
  const { data: datesData } = useQuery({
    queryKey: ['replay-dates', symbol],
    queryFn: () => fetchDates(symbol),
  });

  // Get current window end time
  const currentEndTime = WINDOWS[currentWindow].end;

  // Fetch multi-day chart data
  const { data: chartData, isLoading: chartLoading, error: chartError } = useQuery({
    queryKey: ['train-chart', symbol, selectedDate, currentEndTime],
    queryFn: () => fetchMultiDayData(symbol, selectedDate, currentEndTime),
    enabled: !!selectedDate,
    staleTime: Infinity, // Historical data never changes
  });

  // Fetch options data
  const { data: optionsData } = useQuery({
    queryKey: ['train-options', symbol, selectedDate, currentEndTime],
    queryFn: () => fetchOptions(symbol, selectedDate, currentEndTime),
    enabled: !!selectedDate,
    staleTime: Infinity,
  });

  // Save decision mutation
  const saveDecisionMutation = useMutation({
    mutationFn: saveTrainDecision,
    onSuccess: () => console.log('Decision saved to database'),
    onError: (err) => console.error('Failed to save decision:', err),
  });

  // Get random date (prefer 2025+)
  const getRandomDate = useCallback(() => {
    if (!datesData?.dates?.length) return null;
    const available = datesData.dates.filter((d: string) => !usedDates.has(d));
    const recent = available.filter((d: string) => d >= '2025-01-01');
    const pool = recent.length > 0 ? recent : available;
    if (pool.length === 0) {
      setUsedDates(new Set());
      return datesData.dates[Math.floor(Math.random() * datesData.dates.length)];
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }, [datesData, usedDates]);

  // Initial date selection
  useEffect(() => {
    if (datesData?.dates?.length && !selectedDate) {
      const date = getRandomDate();
      if (date) {
        setSelectedDate(date);
        setUsedDates(prev => new Set(prev).add(date));
      }
    }
  }, [datesData, selectedDate, getRandomDate]);

  // Check if current window has a decision
  const hasDecision = windowDecisions[currentWindow] !== null;

  // Handle decision submission
  const handleDecide = (dir: Direction) => {
    const spotPrice = chartData?.spotPrice || 0;
    setDecision(dir);

    // Save to local state
    setWindowDecisions(prev => ({
      ...prev,
      [currentWindow]: { direction: dir, reasoning, spotPrice },
    }));

    // Save to database
    saveDecisionMutation.mutate({
      symbol,
      date: selectedDate,
      windowNumber: WINDOWS[currentWindow].number,
      direction: dir,
      reasoning,
      spotPriceAtDecision: spotPrice,
    });
  };

  // Handle next window - advance to see more data
  const handleNextWindow = () => {
    if (currentWindow === 'window1') {
      setCurrentWindow('window2');
    } else if (currentWindow === 'window2') {
      setCurrentWindow('window3');
    }
    // Reset decision state for new window
    setDecision(null);
    setReasoning('');
  };

  // Handle new random day - reset everything
  const handleNewDay = () => {
    const date = getRandomDate();
    if (date) {
      setSelectedDate(date);
      setUsedDates(prev => new Set(prev).add(date));
      setCurrentWindow('window1');
      setDecision(null);
      setReasoning('');
      setWindowDecisions({
        window1: null,
        window2: null,
        window3: null,
      });
    }
  };

  // Can advance if we've made a decision and not on last window
  const canAdvance = hasDecision && currentWindow !== 'window3';
  const isLastWindow = currentWindow === 'window3';

  // Count completed windows
  const completedWindows = Object.values(windowDecisions).filter(Boolean).length;

  return (
    <div className="p-6 space-y-4">
      {/* Controls Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-black/30 rounded-lg border border-gray-700">
            <Calendar className="w-4 h-4 text-gray-400" />
            <span className="font-mono">{selectedDate || '----'}</span>
          </div>
          <Button variant="outline" size="sm" onClick={handleNewDay}>
            <Shuffle className="w-4 h-4 mr-1" />
            Random Day
          </Button>
          {/* Progress indicator */}
          <div className="flex items-center gap-1 text-xs text-gray-500">
            {[1, 2, 3].map(n => (
              <div
                key={n}
                className={`w-2 h-2 rounded-full ${
                  windowDecisions[`window${n}` as TimeWindow]
                    ? 'bg-green-500'
                    : currentWindow === `window${n}`
                    ? 'bg-blue-500'
                    : 'bg-gray-600'
                }`}
              />
            ))}
            <span className="ml-1">{completedWindows}/3</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-black/30 rounded-lg border border-gray-700">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="font-mono">{WINDOWS[currentWindow].label}</span>
            <span className="text-xs text-gray-500">
              ({WINDOWS[currentWindow].start} - {WINDOWS[currentWindow].end})
            </span>
            {hasDecision && <CheckCircle className="w-4 h-4 text-green-500" />}
          </div>

          {canAdvance && (
            <Button variant="outline" size="sm" onClick={handleNextWindow}>
              Next Window
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>

        <div className="text-2xl font-mono font-bold">
          ${chartData?.spotPrice?.toFixed(2) || '---'}
        </div>
      </div>

      {/* Error state */}
      {chartError && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-sm">Failed to load chart data. Try another date.</p>
        </div>
      )}

      {/* Chart */}
      <div className="rounded-lg overflow-hidden border border-gray-800">
        <HistoricalChart
          candles={chartData?.candles || []}
          dateMarkers={chartData?.dateMarkers}
          height={350}
        />
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-3 gap-4">
        {/* Options Chain */}
        <div className="col-span-2">
          <OptionsChainDual
            options={optionsData?.options || []}
            spotPrice={chartData?.spotPrice || 0}
            onSelectOption={() => {}}
          />
        </div>

        {/* Decision Panel */}
        <Card className="p-4 bg-[#111118] border-gray-800">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            {hasDecision ? 'Decision Made' : 'Make Decision'}
            {hasDecision && <Lock className="w-4 h-4 text-yellow-500" />}
          </h3>

          {!hasDecision ? (
            <>
              <Textarea
                placeholder="What do you see? Why this direction?"
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
                className="mb-4 bg-black/30 border-gray-700"
                rows={3}
              />

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="border-red-500/50 hover:bg-red-500/20"
                  onClick={() => handleDecide('PUT')}
                >
                  PUT
                </Button>
                <Button
                  variant="outline"
                  className="border-green-500/50 hover:bg-green-500/20"
                  onClick={() => handleDecide('CALL')}
                >
                  CALL
                </Button>
                <Button
                  variant="outline"
                  className="border-purple-500/50 hover:bg-purple-500/20"
                  onClick={() => handleDecide('STRANGLE')}
                >
                  STRANGLE
                </Button>
                <Button
                  variant="outline"
                  className="border-gray-500/50 hover:bg-gray-500/20"
                  onClick={() => handleDecide('NO_TRADE')}
                >
                  NO TRADE
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="text-center py-2">
                <p className="text-lg font-semibold mb-1">
                  <span className={
                    windowDecisions[currentWindow]?.direction === 'PUT' ? 'text-red-400' :
                    windowDecisions[currentWindow]?.direction === 'CALL' ? 'text-green-400' :
                    windowDecisions[currentWindow]?.direction === 'STRANGLE' ? 'text-purple-400' : 'text-gray-400'
                  }>{windowDecisions[currentWindow]?.direction}</span>
                </p>
                <p className="text-sm text-gray-500">at {WINDOWS[currentWindow].end}</p>
                {windowDecisions[currentWindow]?.reasoning && (
                  <p className="text-xs text-gray-600 mt-2 italic">
                    "{windowDecisions[currentWindow]?.reasoning}"
                  </p>
                )}
              </div>

              {canAdvance ? (
                <Button onClick={handleNextWindow} className="w-full">
                  <ChevronRight className="w-4 h-4 mr-2" />
                  Advance to {currentWindow === 'window1' ? 'Next 90 min' : 'Rest of Day'}
                </Button>
              ) : isLastWindow ? (
                <div className="space-y-2">
                  <p className="text-center text-sm text-green-400">
                    Day complete! {completedWindows}/3 decisions made.
                  </p>
                  <Button onClick={handleNewDay} className="w-full">
                    <Shuffle className="w-4 h-4 mr-2" />
                    Next Random Day
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
