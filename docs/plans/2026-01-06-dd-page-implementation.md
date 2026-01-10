# DD Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build unified DD page with Live/Train/Research tabs, 3-day chart context, and 1-minute data capture

**Architecture:** Single DD page with tab navigation. Shared chart component showing 3 previous days + current day with date separators. Mode-specific controls: Live (real-time streaming), Train (fixed 90-min windows, no time travel), Research (jump to any timestamp).

**Tech Stack:** React, TypeScript, lightweight-charts v4, Tailwind CSS, Express, PostgreSQL, Drizzle ORM, IBKR WebSocket

---

## Phase 1: Foundation - Add LeftNav to DD Page

### Task 1.1: Update App.tsx Routing

**Files:**
- Modify: `client/src/App.tsx:186-210`

**Step 1: Update route to use DD component**

Change the replay-trainer route to point to /dd and use a new DD component:

```tsx
// In App.tsx, change:
import ReplayTrainer from "@/pages/ReplayTrainer";

// To:
import { DD } from "@/pages/DD";

// And change the route from:
<Route path="/replay-trainer" component={ReplayTrainer} />

// To:
<Route path="/dd" component={DD} />

// Remove the /dd redirect since DD is now the actual page
```

**Step 2: Verify route works**

Run: `npm run dev`
Navigate to: `http://localhost:5173/dd`
Expected: Page loads (will be empty initially)

**Step 3: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(dd): update routing to use DD page component"
```

---

### Task 1.2: Create Base DD Page with LeftNav

**Files:**
- Modify: `client/src/pages/DD.tsx`

**Step 1: Update DD.tsx to include LeftNav and tab structure**

Replace the entire DD.tsx with a new structure that includes LeftNav:

```tsx
import { useState } from 'react';
import { LeftNav } from '@/components/LeftNav';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export function DD() {
  const [activeTab, setActiveTab] = useState<'live' | 'train' | 'research'>('train');

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Tab Navigation */}
        <div className="border-b border-white/10 px-6 py-2">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
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
          {activeTab === 'live' && (
            <div className="p-6">
              <h2 className="text-xl font-semibold mb-4">Live Mode</h2>
              <p className="text-silver">Real-time market monitoring coming soon...</p>
            </div>
          )}
          {activeTab === 'train' && (
            <div className="p-6">
              <h2 className="text-xl font-semibold mb-4">Train Mode</h2>
              <p className="text-silver">Training mode coming soon...</p>
            </div>
          )}
          {activeTab === 'research' && (
            <div className="p-6">
              <h2 className="text-xl font-semibold mb-4">Research Mode</h2>
              <p className="text-silver">Research mode coming soon...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify tabs work**

Run: `npm run dev`
Navigate to: `http://localhost:5173/dd`
Expected: Page shows LeftNav on left, three tabs (Live/Train/Research) that switch content

**Step 3: Commit**

```bash
git add client/src/pages/DD.tsx
git commit -m "feat(dd): add LeftNav sidebar and tab structure"
```

---

## Phase 2: Multi-Day Chart Component

### Task 2.1: Create API Endpoint for Multi-Day Data

**Files:**
- Modify: `server/replayRoutes.ts`

**Step 1: Add endpoint for fetching multiple days**

Add new endpoint after existing routes:

```typescript
/**
 * GET /api/replay/multi-day/:symbol/:date
 *
 * Get data for a date plus N previous trading days for context.
 * Returns candles for all days combined with date markers.
 */
router.get('/multi-day/:symbol/:date', async (req, res) => {
  try {
    const { symbol, date } = req.params;
    const contextDays = parseInt(req.query.context as string) || 3;
    const upToTime = req.query.time as string | undefined;

    // Get list of available dates
    let allDates = getLocalDates(symbol);
    if (allDates.length === 0) {
      allDates = await getGCSDates(symbol);
    }

    if (allDates.length === 0) {
      res.status(404).json({ error: `No data for symbol ${symbol}` });
      return;
    }

    // Find target date index
    const targetIndex = allDates.indexOf(date);
    if (targetIndex === -1) {
      res.status(404).json({ error: `Date ${date} not found` });
      return;
    }

    // Get previous N days + target day
    const startIndex = Math.max(0, targetIndex - contextDays);
    const datesToFetch = allDates.slice(startIndex, targetIndex + 1);

    // Fetch all days
    const allCandles: any[] = [];
    const dateMarkers: { date: string; startIndex: number }[] = [];

    for (const d of datesToFetch) {
      const dateParts = d.split('-');
      const monthDir = `${dateParts[0]}${dateParts[1]}`;
      const fileName = `${dateParts.join('')}.json`;

      const data = await readDataFile(symbol, monthDir, fileName);
      if (data?.underlyingBars) {
        let candles = data.underlyingBars;

        // If this is the target date and time filter is specified
        if (d === date && upToTime) {
          const timeFilter = `${d}T${upToTime}`;
          candles = candles.filter((c: any) => c.timestamp <= timeFilter);
        }

        dateMarkers.push({ date: d, startIndex: allCandles.length });
        allCandles.push(...candles);
      }
    }

    // Get current spot price (last candle)
    const spotPrice = allCandles.length > 0
      ? allCandles[allCandles.length - 1].close
      : 0;

    res.json({
      symbol: symbol.toUpperCase(),
      targetDate: date,
      contextDays: datesToFetch.length - 1,
      dateMarkers,
      candles: allCandles,
      spotPrice,
      candleCount: allCandles.length,
    });
  } catch (error) {
    console.error('Failed to get multi-day data:', error);
    res.status(500).json({ error: 'Failed to get multi-day data' });
  }
});
```

**Step 2: Test the endpoint**

Run: `npm run dev`
Test: `curl "http://localhost:3000/api/replay/multi-day/SPY/2025-09-15?context=3"`
Expected: JSON with candles from 4 days and dateMarkers array

**Step 3: Commit**

```bash
git add server/replayRoutes.ts
git commit -m "feat(api): add multi-day endpoint for chart context"
```

---

### Task 2.2: Update HistoricalChart for Multi-Day Display

**Files:**
- Modify: `client/src/components/replay/HistoricalChart.tsx`

**Step 1: Add date marker support to chart**

Update the component to accept and display date markers:

```tsx
// Add to interface
interface DateMarker {
  date: string;
  startIndex: number;
}

interface HistoricalChartProps {
  candles: Candle[];
  height?: number;
  currentTime?: string;
  showMA?: boolean;
  maPeriod?: number;
  dateMarkers?: DateMarker[]; // NEW: for date separator lines
}

// In the component, after setting candle data, add vertical lines for dates:
// Inside the useEffect that updates data:

// Add date separator lines
if (dateMarkers && dateMarkers.length > 1 && chartRef.current) {
  // Skip first marker (start of data), add lines for subsequent days
  for (let i = 1; i < dateMarkers.length; i++) {
    const marker = dateMarkers[i];
    if (marker.startIndex < chartData.length) {
      const time = chartData[marker.startIndex].time;
      // Create vertical line at this time
      // lightweight-charts doesn't have built-in vertical lines,
      // so we'll add a price line at this position or use markers
    }
  }
}
```

**Note:** lightweight-charts v4 doesn't have native vertical line support. We'll use a workaround with markers or overlays in the next task.

**Step 2: Commit partial progress**

```bash
git add client/src/components/replay/HistoricalChart.tsx
git commit -m "feat(chart): add dateMarkers prop for multi-day support"
```

---

### Task 2.3: Add Date Labels Below Chart

**Files:**
- Modify: `client/src/components/replay/HistoricalChart.tsx`

**Step 1: Add date labels using chart markers**

Use lightweight-charts markers to show date labels:

```tsx
// After setting candle data, add markers for date changes
if (dateMarkers && dateMarkers.length > 0 && candleSeriesRef.current) {
  const markers = dateMarkers.slice(1).map((marker, i) => {
    if (marker.startIndex >= chartData.length) return null;
    const time = chartData[marker.startIndex].time;
    return {
      time,
      position: 'belowBar' as const,
      color: '#6b7280',
      shape: 'square' as const,
      text: marker.date.slice(5), // Show MM-DD
    };
  }).filter(Boolean);

  candleSeriesRef.current.setMarkers(markers as any);
}
```

**Step 2: Test with multi-day data**

Verify markers appear at day boundaries in the chart.

**Step 3: Commit**

```bash
git add client/src/components/replay/HistoricalChart.tsx
git commit -m "feat(chart): add date markers at day boundaries"
```

---

## Phase 3: Train Mode Implementation

### Task 3.1: Create Train Tab Component

**Files:**
- Create: `client/src/components/dd/TrainTab.tsx`

**Step 1: Create the TrainTab component**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HistoricalChart } from '@/components/replay/HistoricalChart';
import { OptionsChainDual } from '@/components/replay/OptionsChainDual';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Calendar, Clock, Shuffle, ChevronRight, Lock } from 'lucide-react';

type TimeWindow = 'window1' | 'window2' | 'window3';
type Direction = 'PUT' | 'CALL' | 'STRANGLE' | 'NO_TRADE';

interface TrainTabProps {
  symbol?: string;
}

// Time windows
const WINDOWS = {
  window1: { label: 'First 90 min', start: '09:30', end: '11:00' },
  window2: { label: 'Next 90 min', start: '11:00', end: '12:30' },
  window3: { label: 'Rest of day', start: '12:30', end: '16:00' },
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

export function TrainTab({ symbol = 'SPY' }: TrainTabProps) {
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [currentWindow, setCurrentWindow] = useState<TimeWindow>('window1');
  const [decision, setDecision] = useState<Direction | null>(null);
  const [reasoning, setReasoning] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const [usedDates, setUsedDates] = useState<Set<string>>(new Set());

  // Fetch available dates
  const { data: datesData } = useQuery({
    queryKey: ['replay-dates', symbol],
    queryFn: () => fetchDates(symbol),
  });

  // Get current window end time
  const currentEndTime = WINDOWS[currentWindow].end;

  // Fetch multi-day chart data
  const { data: chartData, isLoading: chartLoading } = useQuery({
    queryKey: ['train-chart', symbol, selectedDate, currentEndTime],
    queryFn: () => fetchMultiDayData(symbol, selectedDate, currentEndTime),
    enabled: !!selectedDate,
  });

  // Fetch options data
  const { data: optionsData } = useQuery({
    queryKey: ['train-options', symbol, selectedDate, currentEndTime],
    queryFn: () => fetchOptions(symbol, selectedDate, currentEndTime),
    enabled: !!selectedDate,
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

  // Handle decision submission
  const handleDecide = (dir: Direction) => {
    setDecision(dir);
    setIsLocked(true);
    // TODO: Save to database
    console.log('Decision:', { date: selectedDate, window: currentWindow, direction: dir, reasoning });
  };

  // Handle next window
  const handleNextWindow = () => {
    if (currentWindow === 'window1') setCurrentWindow('window2');
    else if (currentWindow === 'window2') setCurrentWindow('window3');
  };

  // Handle new random day
  const handleNewDay = () => {
    const date = getRandomDate();
    if (date) {
      setSelectedDate(date);
      setUsedDates(prev => new Set(prev).add(date));
      setCurrentWindow('window1');
      setDecision(null);
      setReasoning('');
      setIsLocked(false);
    }
  };

  const canAdvance = !isLocked && currentWindow !== 'window3';

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
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-black/30 rounded-lg border border-gray-700">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="font-mono">{WINDOWS[currentWindow].label}</span>
            <span className="text-xs text-gray-500">
              ({WINDOWS[currentWindow].start} - {WINDOWS[currentWindow].end})
            </span>
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
            Make Decision
            {isLocked && <Lock className="w-4 h-4 text-yellow-500" />}
          </h3>

          {!isLocked ? (
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
            <div className="text-center py-4">
              <p className="text-lg font-semibold mb-2">
                Decision: <span className={
                  decision === 'PUT' ? 'text-red-400' :
                  decision === 'CALL' ? 'text-green-400' :
                  decision === 'STRANGLE' ? 'text-purple-400' : 'text-gray-400'
                }>{decision}</span>
              </p>
              <p className="text-sm text-gray-500 mb-4">at {WINDOWS[currentWindow].end}</p>
              <Button onClick={handleNewDay} className="w-full">
                <Shuffle className="w-4 h-4 mr-2" />
                Next Random Day
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/dd/TrainTab.tsx
git commit -m "feat(dd): create TrainTab component with window progression"
```

---

### Task 3.2: Integrate TrainTab into DD Page

**Files:**
- Modify: `client/src/pages/DD.tsx`

**Step 1: Import and use TrainTab**

```tsx
import { useState } from 'react';
import { LeftNav } from '@/components/LeftNav';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrainTab } from '@/components/dd/TrainTab';

export function DD() {
  const [activeTab, setActiveTab] = useState<'live' | 'train' | 'research'>('train');

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 overflow-hidden flex flex-col bg-[#0a0a0f]">
        {/* Tab Navigation */}
        <div className="border-b border-white/10 px-6 py-2">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
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
          {activeTab === 'live' && (
            <div className="p-6">
              <h2 className="text-xl font-semibold mb-4">Live Mode</h2>
              <p className="text-silver">Real-time market monitoring coming soon...</p>
            </div>
          )}
          {activeTab === 'train' && <TrainTab />}
          {activeTab === 'research' && (
            <div className="p-6">
              <h2 className="text-xl font-semibold mb-4">Research Mode</h2>
              <p className="text-silver">Research mode coming soon...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify Train tab works**

Run: `npm run dev`
Navigate to DD page, click Train tab
Expected: Chart loads with 3-day context, window controls work

**Step 3: Commit**

```bash
git add client/src/pages/DD.tsx
git commit -m "feat(dd): integrate TrainTab component"
```

---

## Phase 4: Research Mode Implementation

### Task 4.1: Create Research Tab Component

**Files:**
- Create: `client/src/components/dd/ResearchTab.tsx`

**Step 1: Create ResearchTab with timestamp jumping**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HistoricalChart } from '@/components/replay/HistoricalChart';
import { OptionsChainDual } from '@/components/replay/OptionsChainDual';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, Clock, Shuffle, Plus, ChevronLeft, ChevronRight } from 'lucide-react';

type Direction = 'PUT' | 'CALL' | 'STRANGLE' | 'WAIT' | 'NO_TRADE';
type Confidence = 'low' | 'medium' | 'high';

interface Observation {
  id: string;
  timestamp: string;
  direction: Direction;
  confidence: Confidence;
  notes: string;
}

// Generate time options from 9:30 to 16:00 in 30-min increments
const TIME_OPTIONS = [];
for (let h = 9; h <= 16; h++) {
  for (let m = 0; m < 60; m += 30) {
    if (h === 9 && m === 0) continue; // Skip 9:00
    if (h === 16 && m > 0) continue; // Only 16:00
    const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    TIME_OPTIONS.push(time);
  }
}

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

export function ResearchTab({ symbol = 'SPY' }: { symbol?: string }) {
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('10:30');
  const [observations, setObservations] = useState<Observation[]>([]);
  const [currentDirection, setCurrentDirection] = useState<Direction>('WAIT');
  const [currentConfidence, setCurrentConfidence] = useState<Confidence>('medium');
  const [currentNotes, setCurrentNotes] = useState('');

  // Fetch available dates
  const { data: datesData } = useQuery({
    queryKey: ['replay-dates', symbol],
    queryFn: () => fetchDates(symbol),
  });

  // Fetch chart data
  const { data: chartData } = useQuery({
    queryKey: ['research-chart', symbol, selectedDate, selectedTime],
    queryFn: () => fetchMultiDayData(symbol, selectedDate, selectedTime),
    enabled: !!selectedDate,
  });

  // Fetch options
  const { data: optionsData } = useQuery({
    queryKey: ['research-options', symbol, selectedDate, selectedTime],
    queryFn: () => fetchOptions(symbol, selectedDate, selectedTime),
    enabled: !!selectedDate,
  });

  // Initial date
  useEffect(() => {
    if (datesData?.dates?.length && !selectedDate) {
      const recent = datesData.dates.filter((d: string) => d >= '2025-01-01');
      const pool = recent.length > 0 ? recent : datesData.dates;
      setSelectedDate(pool[Math.floor(Math.random() * pool.length)]);
    }
  }, [datesData, selectedDate]);

  // Log observation
  const handleLogObservation = () => {
    const newObs: Observation = {
      id: `${Date.now()}`,
      timestamp: selectedTime,
      direction: currentDirection,
      confidence: currentConfidence,
      notes: currentNotes,
    };
    setObservations(prev => [...prev, newObs]);
    setCurrentNotes('');
    // TODO: Save to database
    console.log('Observation logged:', newObs);
  };

  // Navigate time
  const timeIndex = TIME_OPTIONS.indexOf(selectedTime);
  const canGoBack = timeIndex > 0;
  const canGoForward = timeIndex < TIME_OPTIONS.length - 1;

  return (
    <div className="p-6 space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-black/30 rounded-lg border border-gray-700">
            <Calendar className="w-4 h-4 text-gray-400" />
            <span className="font-mono">{selectedDate || '----'}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const recent = datesData?.dates?.filter((d: string) => d >= '2025-01-01') || [];
              const pool = recent.length > 0 ? recent : datesData?.dates || [];
              if (pool.length) {
                setSelectedDate(pool[Math.floor(Math.random() * pool.length)]);
                setObservations([]);
              }
            }}
          >
            <Shuffle className="w-4 h-4 mr-1" />
            Random Day
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            disabled={!canGoBack}
            onClick={() => setSelectedTime(TIME_OPTIONS[timeIndex - 1])}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>

          <Select value={selectedTime} onValueChange={setSelectedTime}>
            <SelectTrigger className="w-32 bg-black/30 border-gray-700">
              <Clock className="w-4 h-4 mr-2 text-gray-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_OPTIONS.map(t => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            disabled={!canGoForward}
            onClick={() => setSelectedTime(TIME_OPTIONS[timeIndex + 1])}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <div className="text-2xl font-mono font-bold">
          ${chartData?.spotPrice?.toFixed(2) || '---'}
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-lg overflow-hidden border border-gray-800">
        <HistoricalChart
          candles={chartData?.candles || []}
          dateMarkers={chartData?.dateMarkers}
          height={300}
        />
      </div>

      {/* Bottom */}
      <div className="grid grid-cols-3 gap-4">
        {/* Options */}
        <div className="col-span-2">
          <OptionsChainDual
            options={optionsData?.options || []}
            spotPrice={chartData?.spotPrice || 0}
            onSelectOption={() => {}}
          />
        </div>

        {/* Observation Panel */}
        <div className="space-y-4">
          <Card className="p-4 bg-[#111118] border-gray-800">
            <h3 className="text-lg font-semibold mb-4">Log Observation</h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Direction</label>
                <div className="grid grid-cols-3 gap-1">
                  {(['PUT', 'CALL', 'STRANGLE', 'WAIT', 'NO_TRADE'] as Direction[]).map(d => (
                    <Button
                      key={d}
                      variant="outline"
                      size="sm"
                      className={currentDirection === d ? 'bg-white/10' : ''}
                      onClick={() => setCurrentDirection(d)}
                    >
                      {d.replace('_', ' ')}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block">Confidence</label>
                <div className="grid grid-cols-3 gap-1">
                  {(['low', 'medium', 'high'] as Confidence[]).map(c => (
                    <Button
                      key={c}
                      variant="outline"
                      size="sm"
                      className={currentConfidence === c ? 'bg-white/10' : ''}
                      onClick={() => setCurrentConfidence(c)}
                    >
                      {c}
                    </Button>
                  ))}
                </div>
              </div>

              <Textarea
                placeholder="What pattern do you see?"
                value={currentNotes}
                onChange={(e) => setCurrentNotes(e.target.value)}
                className="bg-black/30 border-gray-700"
                rows={2}
              />

              <Button className="w-full" onClick={handleLogObservation}>
                <Plus className="w-4 h-4 mr-2" />
                Log Observation
              </Button>
            </div>
          </Card>

          {/* Observations List */}
          {observations.length > 0 && (
            <Card className="p-4 bg-[#111118] border-gray-800 max-h-48 overflow-y-auto">
              <h4 className="text-sm font-semibold mb-2">Observations ({observations.length})</h4>
              <div className="space-y-2">
                {observations.map(obs => (
                  <div key={obs.id} className="text-xs p-2 bg-black/30 rounded">
                    <div className="flex justify-between">
                      <span className="font-mono">{obs.timestamp}</span>
                      <span className={
                        obs.direction === 'PUT' ? 'text-red-400' :
                        obs.direction === 'CALL' ? 'text-green-400' :
                        obs.direction === 'STRANGLE' ? 'text-purple-400' : 'text-gray-400'
                      }>{obs.direction}</span>
                    </div>
                    {obs.notes && <p className="text-gray-500 mt-1">{obs.notes}</p>}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/components/dd/ResearchTab.tsx
git commit -m "feat(dd): create ResearchTab component with timestamp jumping"
```

---

### Task 4.2: Integrate ResearchTab

**Files:**
- Modify: `client/src/pages/DD.tsx`

**Step 1: Add ResearchTab import and render**

```tsx
import { ResearchTab } from '@/components/dd/ResearchTab';

// In the tab content section:
{activeTab === 'research' && <ResearchTab />}
```

**Step 2: Commit**

```bash
git add client/src/pages/DD.tsx
git commit -m "feat(dd): integrate ResearchTab component"
```

---

## Phase 5: Live Mode (Future)

### Task 5.1: Create LiveTab Component (Placeholder)

**Files:**
- Create: `client/src/components/dd/LiveTab.tsx`

This will include:
- Real-time chart with building candle
- Live price line
- Streaming options chain
- Market context (SPY, VIX, DXY)
- Capture status

**Note:** Full implementation requires IBKR WebSocket integration. Create placeholder for now.

---

## Phase 6: Database Schema for 1-Minute Capture

### Task 6.1: Add Live Data Tables to Schema

**Files:**
- Modify: `shared/schema.ts`

**Step 1: Add new tables**

```typescript
// Live 1-minute candles
export const liveCandles = pgTable("live_candles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  timestamp: timestamp("timestamp").notNull(),
  open: doublePrecision("open").notNull(),
  high: doublePrecision("high").notNull(),
  low: doublePrecision("low").notNull(),
  close: doublePrecision("close").notNull(),
  volume: bigint("volume", { mode: 'number' }),
}, (table) => ({
  symbolTimestampIdx: uniqueIndex("live_candles_symbol_timestamp_idx").on(table.symbol, table.timestamp),
}));

// Live 1-minute options snapshots
export const liveOptions = pgTable("live_options", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  timestamp: timestamp("timestamp").notNull(),
  strike: doublePrecision("strike").notNull(),
  right: varchar("right", { length: 4 }).notNull(), // PUT/CALL
  bid: doublePrecision("bid"),
  ask: doublePrecision("ask"),
  delta: doublePrecision("delta"),
  gamma: doublePrecision("gamma"),
  theta: doublePrecision("theta"),
  vega: doublePrecision("vega"),
  iv: doublePrecision("iv"),
  volume: integer("volume"),
  openInterest: integer("open_interest"),
}, (table) => ({
  symbolTimestampStrikeIdx: uniqueIndex("live_options_idx").on(table.symbol, table.timestamp, table.strike, table.right),
}));

// Training observations (for Research mode)
export const observations = pgTable("observations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  timestamp: varchar("timestamp", { length: 5 }).notNull(), // HH:MM
  direction: varchar("direction", { length: 20 }).notNull(),
  confidence: varchar("confidence", { length: 10 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Training decisions (for Train mode)
export const trainDecisions = pgTable("train_decisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  windowNumber: integer("window_number").notNull(), // 1, 2, or 3
  direction: varchar("direction", { length: 20 }).notNull(),
  reasoning: text("reasoning"),
  spotPriceAtDecision: doublePrecision("spot_price_at_decision"),
  outcomeDirection: varchar("outcome_direction", { length: 20 }),
  outcomePnl: doublePrecision("outcome_pnl"),
  wasCorrect: boolean("was_correct"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

**Step 2: Run migration**

```bash
npx drizzle-kit push
```

**Step 3: Commit**

```bash
git add shared/schema.ts
git commit -m "feat(schema): add live data and training tables"
```

---

## Summary

**Implementation Order:**
1. Task 1.1-1.2: Foundation (routing + LeftNav)
2. Task 2.1-2.3: Multi-day chart API and component
3. Task 3.1-3.2: Train mode
4. Task 4.1-4.2: Research mode
5. Task 5.1: Live mode placeholder
6. Task 6.1: Database schema

**Total estimated tasks:** ~12 bite-sized tasks
**Each task:** 2-5 minutes of focused work

---

## Execution

Plan complete and saved to `docs/plans/2026-01-06-dd-page-implementation.md`.

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
