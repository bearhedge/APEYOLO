import { Card } from '@/components/ui/card';
import { Activity, Radio, TrendingUp, Database } from 'lucide-react';

/**
 * LiveTab - Real-time market monitoring placeholder
 *
 * Future implementation will include:
 * - Real-time chart with building candle + live price line
 * - Live options chain streaming
 * - Market context (SPY, VIX, DXY tickers)
 * - 1-minute data capture to database
 * - Connection status to IBKR WebSocket
 */
export function LiveTab() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-gray-500 animate-pulse" />
          <h2 className="text-xl font-semibold">Live Mode</h2>
          <span className="text-sm text-gray-500">(Coming Soon)</span>
        </div>
      </div>

      {/* Feature Preview Cards */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-6 bg-[#111118] border-gray-800">
          <div className="flex items-center gap-3 mb-4">
            <Activity className="w-5 h-5 text-blue-400" />
            <h3 className="font-semibold">Real-Time Chart</h3>
          </div>
          <p className="text-sm text-gray-500">
            Live candlestick chart with building candle animation.
            Updates every 2-3 seconds for real-time market feel.
          </p>
        </Card>

        <Card className="p-6 bg-[#111118] border-gray-800">
          <div className="flex items-center gap-3 mb-4">
            <Radio className="w-5 h-5 text-green-400" />
            <h3 className="font-semibold">Options Streaming</h3>
          </div>
          <p className="text-sm text-gray-500">
            Live options chain with real-time bid/ask, Greeks, and IV.
            Watch premium decay in action.
          </p>
        </Card>

        <Card className="p-6 bg-[#111118] border-gray-800">
          <div className="flex items-center gap-3 mb-4">
            <TrendingUp className="w-5 h-5 text-yellow-400" />
            <h3 className="font-semibold">Market Context</h3>
          </div>
          <p className="text-sm text-gray-500">
            SPY, VIX, DXY ticker tape. See correlations and divergences
            as they happen.
          </p>
        </Card>

        <Card className="p-6 bg-[#111118] border-gray-800">
          <div className="flex items-center gap-3 mb-4">
            <Database className="w-5 h-5 text-purple-400" />
            <h3 className="font-semibold">Data Capture</h3>
          </div>
          <p className="text-sm text-gray-500">
            1-minute OHLCV bars + options snapshots stored locally.
            ~1 GB/year for historical analysis.
          </p>
        </Card>
      </div>

      {/* Status */}
      <Card className="p-4 bg-[#111118] border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-gray-500" />
            <span className="text-sm text-gray-500">IBKR WebSocket</span>
          </div>
          <span className="text-xs text-gray-600">Not Connected</span>
        </div>
      </Card>
    </div>
  );
}
