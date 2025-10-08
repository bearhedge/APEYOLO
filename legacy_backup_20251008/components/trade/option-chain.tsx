import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OptionChainData, FilterConfig } from "@/lib/types";

interface OptionChainProps {
  data?: OptionChainData;
  filters: FilterConfig;
  onBuildSpread: (strike: number) => void;
  livePrice?: number;
}

export default function OptionChain({ data, filters, onBuildSpread, livePrice }: OptionChainProps) {
  if (!data) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="text-muted-foreground">Loading option chain...</div>
        </CardContent>
      </Card>
    );
  }

  // Filter options based on delta range
  const [minDelta, maxDelta] = filters.deltaRange.split('-').map(d => parseFloat(d));
  
  // Group options by strike
  const optionsByStrike = data.options.reduce((acc, option) => {
    if (!acc[option.strike]) {
      acc[option.strike] = {};
    }
    acc[option.strike][option.type] = option;
    return acc;
  }, {} as Record<number, any>);

  // Filter strikes based on delta and OI requirements
  const filteredStrikes = Object.entries(optionsByStrike)
    .filter(([_, options]) => {
      const put = options.put;
      const call = options.call;
      
      // Check if put meets criteria
      if (put && put.openInterest >= filters.minOI) {
        const deltaAbs = Math.abs(put.delta);
        if (deltaAbs >= minDelta && deltaAbs <= maxDelta) {
          return true;
        }
      }
      
      // Check if call meets criteria
      if (call && call.openInterest >= filters.minOI) {
        const deltaAbs = Math.abs(call.delta);
        if (deltaAbs >= minDelta && deltaAbs <= maxDelta) {
          return true;
        }
      }
      
      return false;
    })
    .sort(([a], [b]) => parseFloat(a) - parseFloat(b));

  return (
    <Card>
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Option Chain - {data.symbol}</h3>
          <div className="text-sm text-muted-foreground">
            Underlying: <span className="font-mono text-foreground">${(livePrice || data.underlyingPrice).toFixed(2)}</span>
            {livePrice && livePrice !== data.underlyingPrice && (
              <span className="ml-2 text-blue-400 text-xs">LIVE</span>
            )}
            <span className={`ml-2 ${data.underlyingChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {data.underlyingChange >= 0 ? '+' : ''}{data.underlyingChange.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr>
              <th className="px-4 py-3 text-left">Strike</th>
              <th className="px-4 py-3 text-right">Put Bid</th>
              <th className="px-4 py-3 text-right">Put Ask</th>
              <th className="px-4 py-3 text-right">Put Delta</th>
              <th className="px-4 py-3 text-right">Put OI</th>
              <th className="px-4 py-3 text-center">Actions</th>
              <th className="px-4 py-3 text-right">Call OI</th>
              <th className="px-4 py-3 text-right">Call Delta</th>
              <th className="px-4 py-3 text-right">Call Bid</th>
              <th className="px-4 py-3 text-right">Call Ask</th>
            </tr>
          </thead>
          <tbody>
            {filteredStrikes.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                  No options found matching filter criteria
                </td>
              </tr>
            ) : (
              filteredStrikes.map(([strikeStr, options]) => {
                const strike = parseFloat(strikeStr);
                const put = options.put;
                const call = options.call;
                const isAtTheMoney = Math.abs(strike - data.underlyingPrice) < 2.5;
                
                return (
                  <tr 
                    key={strike}
                    className={cn(
                      "border-b border-border hover:bg-secondary/30 transition-colors option-chain-row",
                      isAtTheMoney && "bg-primary/5 option-chain-row at-the-money"
                    )}
                    data-testid={`option-row-${strike}`}
                  >
                    <td className={cn(
                      "px-4 py-3 font-mono font-medium",
                      isAtTheMoney && "text-primary"
                    )}>
                      {strike}
                    </td>
                    <td className="px-4 py-3 font-mono text-right">
                      {put ? put.bid.toFixed(2) : '-'}
                    </td>
                    <td className="px-4 py-3 font-mono text-right">
                      {put ? put.ask.toFixed(2) : '-'}
                    </td>
                    <td className="px-4 py-3 font-mono text-right text-red-400">
                      {put ? put.delta.toFixed(2) : '-'}
                    </td>
                    <td className="px-4 py-3 font-mono text-right text-muted-foreground">
                      {put ? (put.openInterest > 1000 ? `${(put.openInterest/1000).toFixed(1)}K` : put.openInterest) : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        size="sm"
                        variant={isAtTheMoney ? "default" : "outline"}
                        onClick={() => onBuildSpread(strike)}
                        className={cn(
                          "px-3 py-1 text-xs",
                          isAtTheMoney 
                            ? "bg-primary text-primary-foreground hover:bg-primary/90" 
                            : "bg-primary/20 text-primary hover:bg-primary/30"
                        )}
                        data-testid={`button-build-spread-${strike}`}
                      >
                        Build Spread
                      </Button>
                    </td>
                    <td className="px-4 py-3 font-mono text-right text-muted-foreground">
                      {call ? (call.openInterest > 1000 ? `${(call.openInterest/1000).toFixed(1)}K` : call.openInterest) : '-'}
                    </td>
                    <td className="px-4 py-3 font-mono text-right text-green-400">
                      {call ? call.delta.toFixed(2) : '-'}
                    </td>
                    <td className="px-4 py-3 font-mono text-right">
                      {call ? call.bid.toFixed(2) : '-'}
                    </td>
                    <td className="px-4 py-3 font-mono text-right">
                      {call ? call.ask.toFixed(2) : '-'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
