// @ts-nocheck
/**
 * Chart Test Page - Quick test of Plotly.js for:
 * 1. Candlestick charts (from underlyingBars)
 * 2. Volatility smile (IV vs Strike)
 * 3. 3D Volatility surface (Strike x Time x IV)
 */

import { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// Sample data - will be replaced with API call
const SAMPLE_CANDLES = [
  { timestamp: "2023-01-03T09:30:00", open: 384.37, high: 385.06, low: 383.97, close: 385.06 },
  { timestamp: "2023-01-03T09:35:00", open: 384.51, high: 384.78, low: 384.51, close: 384.78 },
  { timestamp: "2023-01-03T09:40:00", open: 385.39, high: 386.16, low: 385.39, close: 385.95 },
  { timestamp: "2023-01-03T09:45:00", open: 385.27, high: 385.27, low: 383.07, close: 383.07 },
  { timestamp: "2023-01-03T09:50:00", open: 383.5, high: 383.81, low: 382.58, close: 382.93 },
  { timestamp: "2023-01-03T09:55:00", open: 382.81, high: 382.81, low: 381.81, close: 381.81 },
  { timestamp: "2023-01-03T10:00:00", open: 381.71, high: 382.43, low: 381.71, close: 382.41 },
  { timestamp: "2023-01-03T10:05:00", open: 382.12, high: 382.3, low: 381.9, close: 382.21 },
  { timestamp: "2023-01-03T10:10:00", open: 381.97, high: 382.02, low: 381.03, close: 381.03 },
  { timestamp: "2023-01-03T10:15:00", open: 381.17, high: 381.3, low: 380.56, close: 380.56 },
  { timestamp: "2023-01-03T10:20:00", open: 380.25, high: 380.88, low: 380.25, close: 380.88 },
  { timestamp: "2023-01-03T10:25:00", open: 380.82, high: 380.84, low: 380.49, close: 380.49 },
  { timestamp: "2023-01-03T10:30:00", open: 380.95, high: 380.95, low: 380.16, close: 380.48 },
  { timestamp: "2023-01-03T10:35:00", open: 380.62, high: 381.07, low: 380.45, close: 380.89 },
  { timestamp: "2023-01-03T10:40:00", open: 380.75, high: 381.12, low: 380.55, close: 381.02 },
  { timestamp: "2023-01-03T10:45:00", open: 381.15, high: 381.45, low: 380.98, close: 381.32 },
  { timestamp: "2023-01-03T10:50:00", open: 381.28, high: 381.65, low: 381.10, close: 381.55 },
  { timestamp: "2023-01-03T10:55:00", open: 381.48, high: 381.92, low: 381.35, close: 381.78 },
  { timestamp: "2023-01-03T11:00:00", open: 381.72, high: 382.15, low: 381.60, close: 382.05 },
  { timestamp: "2023-01-03T11:05:00", open: 382.00, high: 382.35, low: 381.85, close: 382.22 },
];

// Simulated volatility smile data (IV vs Strike)
// In reality, this comes from the greeks data grouped by strike
const generateVolSmile = (atmPrice: number) => {
  const strikes = [];
  const ivs = [];

  // Generate strikes around ATM
  for (let i = -20; i <= 20; i++) {
    const strike = Math.round(atmPrice + i * 2);
    strikes.push(strike);

    // Classic volatility smile shape - higher IV for OTM options
    const moneyness = Math.abs(strike - atmPrice) / atmPrice;
    const baseIV = 0.18; // ATM IV ~18%
    const skew = 0.02 * Math.sign(atmPrice - strike); // Put skew
    const smile = 0.5 * Math.pow(moneyness, 2); // Smile curvature
    ivs.push(baseIV + skew + smile);
  }

  return { strikes, ivs };
};

// Generate 3D volatility surface data
const generateVolSurface = (atmPrice: number) => {
  const strikes: number[] = [];
  const expirations: number[] = [0, 1, 2, 5, 10, 20, 30]; // Days to expiry
  const ivSurface: number[][] = [];

  // Generate strikes
  for (let i = -15; i <= 15; i++) {
    strikes.push(Math.round(atmPrice + i * 2));
  }

  // Generate IV surface
  for (const dte of expirations) {
    const row: number[] = [];
    for (const strike of strikes) {
      const moneyness = Math.abs(strike - atmPrice) / atmPrice;
      const baseIV = 0.18;
      const termStructure = 0.02 * Math.exp(-dte / 30); // Higher IV for shorter DTE
      const smile = 0.4 * Math.pow(moneyness, 2);
      const skew = 0.015 * Math.sign(atmPrice - strike);
      row.push(baseIV + termStructure + smile + skew);
    }
    ivSurface.push(row);
  }

  return { strikes, expirations, ivSurface };
};

export default function ChartTest() {
  const [candles, setCandles] = useState(SAMPLE_CANDLES);
  const [atmPrice] = useState(381.5);

  const volSmile = generateVolSmile(atmPrice);
  const volSurface = generateVolSurface(atmPrice);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Plotly.js Chart Quality Test</h1>
          <p className="text-gray-400">Testing candlesticks, vol smile, and 3D surface</p>
        </div>

        {/* Candlestick Chart */}
        <Card className="bg-[#111118] border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">1. Candlestick Chart (5-min SPY)</CardTitle>
          </CardHeader>
          <CardContent>
            <Plot
              data={[
                {
                  type: 'candlestick',
                  x: candles.map(c => c.timestamp),
                  open: candles.map(c => c.open),
                  high: candles.map(c => c.high),
                  low: candles.map(c => c.low),
                  close: candles.map(c => c.close),
                  increasing: { line: { color: '#22c55e' } },
                  decreasing: { line: { color: '#ef4444' } },
                },
              ]}
              layout={{
                title: {
                  text: 'SPY 5-min Candles - Jan 3, 2023',
                  font: { color: '#fff' }
                },
                paper_bgcolor: '#111118',
                plot_bgcolor: '#111118',
                xaxis: {
                  title: 'Time',
                  color: '#888',
                  gridcolor: '#333',
                  rangeslider: { visible: false },
                },
                yaxis: {
                  title: 'Price',
                  color: '#888',
                  gridcolor: '#333',
                },
                margin: { t: 50, b: 50, l: 60, r: 30 },
                height: 400,
              }}
              config={{
                displayModeBar: true,
                scrollZoom: true,
              }}
              style={{ width: '100%' }}
            />
          </CardContent>
        </Card>

        {/* Volatility Smile */}
        <Card className="bg-[#111118] border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">2. Volatility Smile (IV vs Strike)</CardTitle>
          </CardHeader>
          <CardContent>
            <Plot
              data={[
                {
                  type: 'scatter',
                  mode: 'lines+markers',
                  x: volSmile.strikes,
                  y: volSmile.ivs.map(iv => iv * 100), // Convert to percentage
                  line: { color: '#3b82f6', width: 2 },
                  marker: { size: 6 },
                  name: 'Implied Volatility',
                },
                {
                  type: 'scatter',
                  mode: 'lines',
                  x: [atmPrice, atmPrice],
                  y: [15, 25],
                  line: { color: '#f59e0b', dash: 'dash', width: 1 },
                  name: 'ATM Strike',
                },
              ]}
              layout={{
                title: {
                  text: 'Volatility Smile - 0DTE Options',
                  font: { color: '#fff' }
                },
                paper_bgcolor: '#111118',
                plot_bgcolor: '#111118',
                xaxis: {
                  title: 'Strike Price',
                  color: '#888',
                  gridcolor: '#333',
                },
                yaxis: {
                  title: 'Implied Volatility (%)',
                  color: '#888',
                  gridcolor: '#333',
                },
                margin: { t: 50, b: 50, l: 60, r: 30 },
                height: 350,
                showlegend: true,
                legend: { font: { color: '#888' } },
              }}
              config={{
                displayModeBar: true,
              }}
              style={{ width: '100%' }}
            />
          </CardContent>
        </Card>

        {/* 3D Volatility Surface */}
        <Card className="bg-[#111118] border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">3. 3D Volatility Surface (Strike × DTE × IV)</CardTitle>
          </CardHeader>
          <CardContent>
            <Plot
              data={[
                {
                  type: 'surface',
                  x: volSurface.strikes,
                  y: volSurface.expirations,
                  z: volSurface.ivSurface.map(row => row.map(iv => iv * 100)),
                  colorscale: 'Viridis',
                  showscale: true,
                  colorbar: {
                    title: 'IV (%)',
                    titlefont: { color: '#888' },
                    tickfont: { color: '#888' },
                  },
                },
              ]}
              layout={{
                title: {
                  text: '3D Volatility Surface',
                  font: { color: '#fff' }
                },
                paper_bgcolor: '#111118',
                scene: {
                  xaxis: { title: 'Strike', color: '#888', gridcolor: '#444' },
                  yaxis: { title: 'Days to Expiry', color: '#888', gridcolor: '#444' },
                  zaxis: { title: 'IV (%)', color: '#888', gridcolor: '#444' },
                  bgcolor: '#111118',
                  camera: {
                    eye: { x: 1.5, y: 1.5, z: 1.2 }
                  },
                },
                margin: { t: 50, b: 20, l: 20, r: 20 },
                height: 500,
              }}
              config={{
                displayModeBar: true,
              }}
              style={{ width: '100%' }}
            />
          </CardContent>
        </Card>

        {/* Verdict Section */}
        <Card className="bg-[#111118] border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">Your Verdict</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-400">
              Interact with the charts above. Zoom, pan, rotate the 3D surface.
              Then decide: Is Plotly good enough for production?
            </p>
            <div className="flex gap-4">
              <Button variant="outline" className="border-green-500 text-green-500 hover:bg-green-500/10">
                ✓ Plotly is good enough
              </Button>
              <Button variant="outline" className="border-red-500 text-red-500 hover:bg-red-500/10">
                ✗ Need something else
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
