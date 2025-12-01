/**
 * Deterministic Chart Engine
 *
 * A custom Canvas 2D chart renderer with full determinism guarantees:
 * - Integer pixel coordinates only (no sub-pixel rendering)
 * - Fixed render order: background → grid → candles → axes → crosshair
 * - No randomness in render path
 * - SHA256 hash of output for verification
 *
 * Key design decisions:
 * - Uses integer math for all coordinate calculations
 * - Explicit canvas context state management
 * - Supports zoom/pan via viewport transformation
 * - Clean, minimal visual design (dark theme)
 */

// ============================================
// Types
// ============================================

export interface Bar {
  time: number;    // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface ChartConfig {
  width: number;
  height: number;
  candleWidth: number;
  candleSpacing: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  colors: {
    background: string;
    bullish: string;
    bearish: string;
    wick: string;
    grid: string;
    gridMinor: string;
    text: string;
    crosshair: string;
    priceLabel: string;
    // Engine-driven bounds overlay colors
    winZone: string;
    dangerZone: string;
    putStrikeLine: string;
    callStrikeLine: string;
    currentPriceLine: string;
  };
  font: {
    family: string;
    size: number;
  };
}

// Engine-driven bounds overlay configuration
export interface ChartOverlays {
  putStrike?: number;      // PUT strike price (lower bound)
  callStrike?: number;     // CALL strike price (upper bound)
  currentPrice?: number;   // Live current price
  showZones?: boolean;     // Whether to show win/danger zones
}

export interface Viewport {
  startIndex: number;
  endIndex: number;
}

export interface ChartInput {
  bars: Bar[];
  config: ChartConfig;
  viewport: Viewport;
  crosshair?: { x: number; y: number } | null;
  overlays?: ChartOverlays;  // Engine-driven bounds overlays
}

export interface ChartOutput {
  canvas: HTMLCanvasElement;
  hash: string;
  metadata: {
    barCount: number;
    priceRange: { min: number; max: number };
    timeRange: { start: number; end: number };
    viewport: Viewport;
    renderTime: number;
    version: string;
  };
}

// ============================================
// Default Configuration
// ============================================

export const DEFAULT_CONFIG: ChartConfig = {
  width: 800,
  height: 400,
  candleWidth: 8,
  candleSpacing: 2,
  paddingTop: 20,
  paddingBottom: 30,
  paddingLeft: 10,
  paddingRight: 70,
  colors: {
    background: '#0a0a0a',
    bullish: '#22c55e',
    bearish: '#ef4444',
    wick: '#6b7280',
    grid: '#1f2937',
    gridMinor: '#111827',
    text: '#9ca3af',
    crosshair: '#4b5563',
    priceLabel: '#374151',
    // Engine-driven bounds overlay colors
    winZone: 'rgba(34, 197, 94, 0.12)',      // Semi-transparent green
    dangerZone: 'rgba(239, 68, 68, 0.08)',   // Semi-transparent red
    putStrikeLine: '#ef4444',                 // Red for PUT
    callStrikeLine: '#3b82f6',                // Blue for CALL
    currentPriceLine: '#fbbf24',              // Amber for current price
  },
  font: {
    family: 'SF Mono, Monaco, Consolas, monospace',
    size: 11,
  },
};

// ============================================
// Coordinate System (Integer Math)
// ============================================

interface CoordinateSystem {
  priceToY: (price: number) => number;
  yToPrice: (y: number) => number;
  indexToX: (index: number) => number;
  xToIndex: (x: number) => number;
  priceMin: number;
  priceMax: number;
  chartArea: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  };
}

function createCoordinateSystem(
  bars: Bar[],
  viewport: Viewport,
  config: ChartConfig
): CoordinateSystem {
  const { width, height, paddingTop, paddingBottom, paddingLeft, paddingRight } = config;
  const { candleWidth, candleSpacing } = config;

  const chartArea = {
    left: paddingLeft,
    right: width - paddingRight,
    top: paddingTop,
    bottom: height - paddingBottom,
    width: width - paddingLeft - paddingRight,
    height: height - paddingTop - paddingBottom,
  };

  // Get visible bars
  const visibleBars = bars.slice(viewport.startIndex, viewport.endIndex + 1);

  // Calculate price range with 5% padding
  let priceMin = Infinity;
  let priceMax = -Infinity;

  for (const bar of visibleBars) {
    if (bar.low < priceMin) priceMin = bar.low;
    if (bar.high > priceMax) priceMax = bar.high;
  }

  // Add padding (5% on each side)
  const priceRange = priceMax - priceMin;
  const pricePadding = priceRange * 0.05;
  priceMin = priceMin - pricePadding;
  priceMax = priceMax + pricePadding;

  // Ensure valid range
  if (priceMin === priceMax) {
    priceMin = priceMin * 0.99;
    priceMax = priceMax * 1.01;
  }

  const candleTotalWidth = candleWidth + candleSpacing;
  const visibleCount = viewport.endIndex - viewport.startIndex + 1;

  return {
    priceMin,
    priceMax,
    chartArea,
    priceToY: (price: number): number => {
      const ratio = (price - priceMin) / (priceMax - priceMin);
      // Invert Y (price increases upward)
      return Math.round(chartArea.bottom - ratio * chartArea.height);
    },
    yToPrice: (y: number): number => {
      const ratio = (chartArea.bottom - y) / chartArea.height;
      return priceMin + ratio * (priceMax - priceMin);
    },
    indexToX: (index: number): number => {
      const relativeIndex = index - viewport.startIndex;
      return Math.round(chartArea.left + relativeIndex * candleTotalWidth + candleWidth / 2);
    },
    xToIndex: (x: number): number => {
      const relativeX = x - chartArea.left;
      return Math.round(viewport.startIndex + relativeX / candleTotalWidth);
    },
  };
}

// ============================================
// Renderers
// ============================================

function renderBackground(
  ctx: CanvasRenderingContext2D,
  config: ChartConfig
): void {
  ctx.fillStyle = config.colors.background;
  ctx.fillRect(0, 0, config.width, config.height);
}

function renderGrid(
  ctx: CanvasRenderingContext2D,
  coords: CoordinateSystem,
  config: ChartConfig
): void {
  const { chartArea, priceMin, priceMax } = coords;

  // Calculate nice price intervals
  const priceRange = priceMax - priceMin;
  const targetLines = 5;
  const rawInterval = priceRange / targetLines;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
  const normalizedInterval = rawInterval / magnitude;

  let interval: number;
  if (normalizedInterval < 1.5) interval = 1 * magnitude;
  else if (normalizedInterval < 3) interval = 2 * magnitude;
  else if (normalizedInterval < 7) interval = 5 * magnitude;
  else interval = 10 * magnitude;

  // Draw horizontal grid lines
  ctx.strokeStyle = config.colors.grid;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  const startPrice = Math.ceil(priceMin / interval) * interval;

  for (let price = startPrice; price <= priceMax; price += interval) {
    const y = coords.priceToY(price);
    if (y >= chartArea.top && y <= chartArea.bottom) {
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y + 0.5);
      ctx.lineTo(chartArea.right, y + 0.5);
      ctx.stroke();
    }
  }
}

function renderCandles(
  ctx: CanvasRenderingContext2D,
  bars: Bar[],
  viewport: Viewport,
  coords: CoordinateSystem,
  config: ChartConfig
): void {
  const { candleWidth } = config;
  const halfWidth = Math.floor(candleWidth / 2);

  for (let i = viewport.startIndex; i <= viewport.endIndex && i < bars.length; i++) {
    const bar = bars[i];
    const x = coords.indexToX(i);
    const isBullish = bar.close >= bar.open;

    const openY = coords.priceToY(bar.open);
    const closeY = coords.priceToY(bar.close);
    const highY = coords.priceToY(bar.high);
    const lowY = coords.priceToY(bar.low);

    // Draw wick (high-low line)
    ctx.strokeStyle = config.colors.wick;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, highY);
    ctx.lineTo(x + 0.5, lowY);
    ctx.stroke();

    // Draw body
    const bodyTop = Math.min(openY, closeY);
    const bodyBottom = Math.max(openY, closeY);
    const bodyHeight = Math.max(1, bodyBottom - bodyTop);

    ctx.fillStyle = isBullish ? config.colors.bullish : config.colors.bearish;
    ctx.fillRect(
      x - halfWidth,
      bodyTop,
      candleWidth,
      bodyHeight
    );
  }
}

function renderPriceAxis(
  ctx: CanvasRenderingContext2D,
  coords: CoordinateSystem,
  config: ChartConfig
): void {
  const { chartArea, priceMin, priceMax } = coords;

  // Calculate nice price intervals
  const priceRange = priceMax - priceMin;
  const targetLines = 5;
  const rawInterval = priceRange / targetLines;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
  const normalizedInterval = rawInterval / magnitude;

  let interval: number;
  if (normalizedInterval < 1.5) interval = 1 * magnitude;
  else if (normalizedInterval < 3) interval = 2 * magnitude;
  else if (normalizedInterval < 7) interval = 5 * magnitude;
  else interval = 10 * magnitude;

  ctx.font = `${config.font.size}px ${config.font.family}`;
  ctx.fillStyle = config.colors.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const startPrice = Math.ceil(priceMin / interval) * interval;

  for (let price = startPrice; price <= priceMax; price += interval) {
    const y = coords.priceToY(price);
    if (y >= chartArea.top && y <= chartArea.bottom) {
      const label = price.toFixed(2);
      ctx.fillText(label, chartArea.right + 5, y);
    }
  }
}

function renderTimeAxis(
  ctx: CanvasRenderingContext2D,
  bars: Bar[],
  viewport: Viewport,
  coords: CoordinateSystem,
  config: ChartConfig
): void {
  const { chartArea } = coords;

  ctx.font = `${config.font.size}px ${config.font.family}`;
  ctx.fillStyle = config.colors.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Show time labels at regular intervals
  const visibleBars = viewport.endIndex - viewport.startIndex + 1;
  const labelInterval = Math.max(1, Math.floor(visibleBars / 6));

  for (let i = viewport.startIndex; i <= viewport.endIndex && i < bars.length; i += labelInterval) {
    const bar = bars[i];
    const x = coords.indexToX(i);

    const date = new Date(bar.time * 1000);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const label = `${hours}:${minutes}`;

    ctx.fillText(label, x, chartArea.bottom + 5);
  }
}

function renderCrosshair(
  ctx: CanvasRenderingContext2D,
  crosshair: { x: number; y: number },
  bars: Bar[],
  coords: CoordinateSystem,
  config: ChartConfig
): void {
  const { chartArea } = coords;
  const { x, y } = crosshair;

  // Only draw if within chart area
  if (x < chartArea.left || x > chartArea.right ||
      y < chartArea.top || y > chartArea.bottom) {
    return;
  }

  ctx.strokeStyle = config.colors.crosshair;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  // Vertical line
  ctx.beginPath();
  ctx.moveTo(x + 0.5, chartArea.top);
  ctx.lineTo(x + 0.5, chartArea.bottom);
  ctx.stroke();

  // Horizontal line
  ctx.beginPath();
  ctx.moveTo(chartArea.left, y + 0.5);
  ctx.lineTo(chartArea.right, y + 0.5);
  ctx.stroke();

  ctx.setLineDash([]);

  // Price label on right
  const price = coords.yToPrice(y);
  const priceLabel = price.toFixed(2);
  const labelWidth = ctx.measureText(priceLabel).width + 10;
  const labelHeight = config.font.size + 6;

  ctx.fillStyle = config.colors.priceLabel;
  ctx.fillRect(chartArea.right + 2, y - labelHeight / 2, labelWidth, labelHeight);

  ctx.fillStyle = config.colors.text;
  ctx.font = `${config.font.size}px ${config.font.family}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(priceLabel, chartArea.right + 7, y);
}

// ============================================
// Engine-Driven Bounds Overlay Renderers
// ============================================

/**
 * Render a shaded zone between two price levels
 * Used for win zone (between strikes) and danger zones (beyond strikes)
 */
function renderZone(
  ctx: CanvasRenderingContext2D,
  priceHigh: number,
  priceLow: number,
  coords: CoordinateSystem,
  config: ChartConfig,
  color: string
): void {
  const { chartArea } = coords;

  // Clamp prices to visible range
  const clampedHigh = Math.min(priceHigh, coords.priceMax);
  const clampedLow = Math.max(priceLow, coords.priceMin);

  if (clampedHigh <= clampedLow) return;

  const yHigh = coords.priceToY(clampedHigh);
  const yLow = coords.priceToY(clampedLow);

  ctx.fillStyle = color;
  ctx.fillRect(chartArea.left, yHigh, chartArea.width, yLow - yHigh);
}

/**
 * Render a strike price line with label
 * Dashed horizontal line indicating PUT or CALL strike
 */
function renderStrikeLine(
  ctx: CanvasRenderingContext2D,
  price: number,
  coords: CoordinateSystem,
  config: ChartConfig,
  color: string,
  label: string,
  labelPosition: 'left' | 'right' = 'left'
): void {
  const { chartArea } = coords;

  // Don't render if price is outside visible range
  if (price < coords.priceMin || price > coords.priceMax) return;

  const y = coords.priceToY(price);

  // Dashed line across chart
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(chartArea.left, Math.round(y) + 0.5);
  ctx.lineTo(chartArea.right, Math.round(y) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  // Label background and text
  ctx.font = `bold ${config.font.size}px ${config.font.family}`;
  const labelWidth = ctx.measureText(label).width + 8;
  const labelHeight = config.font.size + 4;

  const labelX = labelPosition === 'left'
    ? chartArea.left + 4
    : chartArea.right - labelWidth - 4;
  const labelY = y - labelHeight - 2;

  // Label background
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
  ctx.globalAlpha = 1.0;

  // Label text
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, labelX + 4, labelY + labelHeight / 2);
}

/**
 * Render current price line with prominent badge
 * Solid amber line showing live price position
 */
function renderCurrentPriceLine(
  ctx: CanvasRenderingContext2D,
  price: number,
  coords: CoordinateSystem,
  config: ChartConfig
): void {
  const { chartArea } = coords;

  // Don't render if price is outside visible range
  if (price < coords.priceMin || price > coords.priceMax) return;

  const y = coords.priceToY(price);
  const color = config.colors.currentPriceLine;

  // Solid bright line
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(chartArea.left, Math.round(y) + 0.5);
  ctx.lineTo(chartArea.right, Math.round(y) + 0.5);
  ctx.stroke();

  // Price badge on right side (outside chart area)
  const label = `$${price.toFixed(2)}`;
  ctx.font = `bold ${config.font.size}px ${config.font.family}`;
  const labelWidth = ctx.measureText(label).width + 12;
  const labelHeight = config.font.size + 8;

  // Badge background
  ctx.fillStyle = color;
  ctx.fillRect(chartArea.right + 2, y - labelHeight / 2, labelWidth, labelHeight);

  // Badge text
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, chartArea.right + 8, y);
}

/**
 * Render all overlay zones (called before candles)
 * Draws win zone and danger zones as background shading
 */
function renderOverlayZones(
  ctx: CanvasRenderingContext2D,
  overlays: ChartOverlays,
  coords: CoordinateSystem,
  config: ChartConfig
): void {
  const { putStrike, callStrike, showZones = true } = overlays;

  if (!showZones) return;

  // Need both strikes to render zones
  if (putStrike !== undefined && callStrike !== undefined) {
    // Win zone (between strikes) - green
    renderZone(ctx, callStrike, putStrike, coords, config, config.colors.winZone);

    // Upper danger zone (above call strike) - red
    renderZone(ctx, coords.priceMax, callStrike, coords, config, config.colors.dangerZone);

    // Lower danger zone (below put strike) - red
    renderZone(ctx, putStrike, coords.priceMin, coords, config, config.colors.dangerZone);
  }
}

/**
 * Render all overlay lines (called after candles)
 * Draws strike lines and current price marker
 */
function renderOverlayLines(
  ctx: CanvasRenderingContext2D,
  overlays: ChartOverlays,
  coords: CoordinateSystem,
  config: ChartConfig
): void {
  const { putStrike, callStrike, currentPrice } = overlays;

  // PUT strike line (red, lower bound)
  if (putStrike !== undefined) {
    renderStrikeLine(
      ctx, putStrike, coords, config,
      config.colors.putStrikeLine,
      `PUT $${putStrike}`,
      'left'
    );
  }

  // CALL strike line (blue, upper bound)
  if (callStrike !== undefined) {
    renderStrikeLine(
      ctx, callStrike, coords, config,
      config.colors.callStrikeLine,
      `CALL $${callStrike}`,
      'left'
    );
  }

  // Current price line (amber, most prominent)
  if (currentPrice !== undefined) {
    renderCurrentPriceLine(ctx, currentPrice, coords, config);
  }
}

// ============================================
// Hash Calculation (for determinism verification)
// ============================================

async function computeCanvasHash(canvas: HTMLCanvasElement): Promise<string> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'no-context';

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Use SubtleCrypto for SHA-256 if available
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback: simple checksum
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data[i]) | 0;
  }
  return hash.toString(16);
}

// ============================================
// Main Render Function
// ============================================

export class DeterministicChartEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: ChartConfig;

  constructor(canvas: HTMLCanvasElement, config: Partial<ChartConfig> = {}) {
    this.canvas = canvas;
    this.config = { ...DEFAULT_CONFIG, ...config };

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Could not get 2D context');
    }
    this.ctx = ctx;

    // Set canvas dimensions
    this.canvas.width = this.config.width;
    this.canvas.height = this.config.height;
  }

  updateConfig(config: Partial<ChartConfig>): void {
    this.config = { ...this.config, ...config };
    this.canvas.width = this.config.width;
    this.canvas.height = this.config.height;
  }

  async render(input: ChartInput): Promise<ChartOutput> {
    const startTime = performance.now();
    const { bars, viewport, crosshair, overlays } = input;
    const config = { ...this.config, ...input.config };

    // Validate input
    if (!bars || bars.length === 0) {
      throw new Error('No bars provided');
    }

    const safeViewport: Viewport = {
      startIndex: Math.max(0, viewport.startIndex),
      endIndex: Math.min(bars.length - 1, viewport.endIndex),
    };

    // Create coordinate system
    const coords = createCoordinateSystem(bars, safeViewport, config);

    // Reset canvas state
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Render in fixed order (deterministic)
    // 1. Background
    renderBackground(this.ctx, config);

    // 2. Grid
    renderGrid(this.ctx, coords, config);

    // 3. Engine-driven overlay zones (behind candles)
    if (overlays) {
      renderOverlayZones(this.ctx, overlays, coords, config);
    }

    // 4. Candlesticks
    renderCandles(this.ctx, bars, safeViewport, coords, config);

    // 5. Engine-driven overlay lines (on top of candles)
    if (overlays) {
      renderOverlayLines(this.ctx, overlays, coords, config);
    }

    // 6. Axes
    renderPriceAxis(this.ctx, coords, config);
    renderTimeAxis(this.ctx, bars, safeViewport, coords, config);

    // 7. Crosshair (always on top)
    if (crosshair) {
      renderCrosshair(this.ctx, crosshair, bars, coords, config);
    }

    this.ctx.restore();

    // Compute hash for determinism verification
    const hash = await computeCanvasHash(this.canvas);

    const renderTime = performance.now() - startTime;

    return {
      canvas: this.canvas,
      hash,
      metadata: {
        barCount: bars.length,
        priceRange: { min: coords.priceMin, max: coords.priceMax },
        timeRange: {
          start: bars[safeViewport.startIndex]?.time || 0,
          end: bars[safeViewport.endIndex]?.time || 0,
        },
        viewport: safeViewport,
        renderTime,
        version: '1.0.0',
      },
    };
  }

  // Get coordinates for a mouse position
  getBarAtPosition(x: number, y: number, bars: Bar[], viewport: Viewport): Bar | null {
    const coords = createCoordinateSystem(bars, viewport, this.config);
    const index = coords.xToIndex(x);

    if (index >= 0 && index < bars.length) {
      return bars[index];
    }
    return null;
  }

  // Get price at Y position
  getPriceAtY(y: number, bars: Bar[], viewport: Viewport): number {
    const coords = createCoordinateSystem(bars, viewport, this.config);
    return coords.yToPrice(y);
  }
}

// ============================================
// Utility Functions
// ============================================

export function calculateViewport(
  totalBars: number,
  visibleBars: number,
  offset: number = 0
): Viewport {
  const endIndex = Math.max(0, totalBars - 1 - offset);
  const startIndex = Math.max(0, endIndex - visibleBars + 1);

  return { startIndex, endIndex };
}

export function formatPrice(price: number): string {
  return price.toFixed(2);
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}
