import { useQuery } from '@tanstack/react-query';
import { MiniChart } from './MiniChart';
import { TrendingUp, TrendingDown, ExternalLink, RefreshCw } from 'lucide-react';
import { Link } from 'wouter';

interface MiniPriceWidgetProps {
  symbol: string;
  showLink?: boolean;
  testId?: string;
}

interface MarketData {
  price: number;
  change: number;
  changePct: number;
}

export function MiniPriceWidget({ symbol, showLink = true, testId }: MiniPriceWidgetProps) {
  const { data: marketData, isLoading, error } = useQuery<MarketData>({
    queryKey: ['/api/broker/test-market', symbol],
    queryFn: async () => {
      const res = await fetch(`/api/broker/test-market/${symbol}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch market data');
      const data = await res.json();
      return {
        price: data.price || 0,
        change: data.change || 0,
        changePct: data.changePct || 0,
      };
    },
    refetchInterval: 5000,
  });

  // Generate sparkline data
  const generateSparklineData = (basePrice: number): number[] => {
    const points = [];
    let price = basePrice * 0.998;
    for (let i = 0; i < 15; i++) {
      price = price + (Math.random() - 0.5) * (basePrice * 0.002);
      points.push(price);
    }
    points.push(basePrice);
    return points;
  };

  const sparklineData = marketData?.price ? generateSparklineData(marketData.price) : [];
  const isPriceUp = (marketData?.change || 0) >= 0;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-silver" data-testid={testId}>
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span>Loading {symbol}...</span>
      </div>
    );
  }

  if (error || !marketData) {
    return (
      <div className="flex items-center gap-2 text-silver" data-testid={testId}>
        <span>{symbol}: No data</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-4 p-3 bg-white/5 rounded-lg border border-white/10"
      data-testid={testId}
    >
      {/* Symbol and Price */}
      <div className="flex flex-col">
        <span className="text-sm font-medium text-silver">{symbol}</span>
        <span className="text-xl font-bold tabular-nums">
          ${marketData.price.toFixed(2)}
        </span>
      </div>

      {/* Change indicator */}
      <div className={`flex items-center gap-1 ${isPriceUp ? 'text-green-500' : 'text-red-500'}`}>
        {isPriceUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
        <div className="flex flex-col text-sm">
          <span className="tabular-nums">
            {isPriceUp ? '+' : ''}{marketData.change.toFixed(2)}
          </span>
          <span className="text-xs tabular-nums">
            ({isPriceUp ? '+' : ''}{marketData.changePct.toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* Mini sparkline */}
      {sparklineData.length > 0 && (
        <div className="flex-shrink-0">
          <MiniChart
            data={sparklineData}
            width={80}
            height={32}
            color={isPriceUp ? '#10B981' : '#EF4444'}
          />
        </div>
      )}

      {/* Link to DD page */}
      {showLink && (
        <Link href="/dd">
          <a className="flex items-center gap-1 text-xs text-silver hover:text-white transition ml-auto">
            <span>Full chart</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </Link>
      )}
    </div>
  );
}
