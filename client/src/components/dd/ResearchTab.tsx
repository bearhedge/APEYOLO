import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
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
const TIME_OPTIONS: string[] = [];
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

async function saveObservation(data: {
  symbol: string;
  date: string;
  timestamp: string;
  direction: string;
  confidence: string;
  notes: string;
}) {
  const res = await fetch('/api/dd/observations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to save observation');
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

  // Save observation mutation
  const saveObservationMutation = useMutation({
    mutationFn: saveObservation,
    onSuccess: () => console.log('Observation saved to database'),
    onError: (err) => console.error('Failed to save observation:', err),
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

    // Save to database
    saveObservationMutation.mutate({
      symbol,
      date: selectedDate,
      timestamp: selectedTime,
      direction: currentDirection,
      confidence: currentConfidence,
      notes: currentNotes,
    });
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
