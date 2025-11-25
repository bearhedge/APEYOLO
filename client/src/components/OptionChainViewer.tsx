import { ChevronDown, ChevronRight } from 'lucide-react';

export interface OptionStrike {
  strike: number;
  bid: number;
  ask: number;
  delta: number;
  oi?: number;
}

export interface OptionChainViewerProps {
  underlyingPrice: number;
  selectedPutStrike?: number;
  selectedCallStrike?: number;
  optionChain?: {
    puts: OptionStrike[];
    calls: OptionStrike[];
  };
  isExpanded: boolean;
  onToggle: () => void;
  expiration?: string;
}

export function OptionChainViewer({
  underlyingPrice,
  selectedPutStrike,
  selectedCallStrike,
  optionChain,
  isExpanded,
  onToggle,
  expiration = '0DTE'
}: OptionChainViewerProps) {
  // Filter to show 5-7 strikes around selected strikes
  const filterStrikes = (strikes: OptionStrike[], selectedStrike?: number): OptionStrike[] => {
    if (!strikes || strikes.length === 0) return [];

    if (selectedStrike) {
      // Sort by distance from selected strike
      const sorted = [...strikes].sort((a, b) =>
        Math.abs(a.strike - selectedStrike) - Math.abs(b.strike - selectedStrike)
      );
      // Take 5 closest strikes
      return sorted.slice(0, 5).sort((a, b) => a.strike - b.strike);
    }

    // If no selection, show strikes around ATM
    const sorted = [...strikes].sort((a, b) =>
      Math.abs(a.strike - underlyingPrice) - Math.abs(b.strike - underlyingPrice)
    );
    return sorted.slice(0, 5).sort((a, b) => a.strike - b.strike);
  };

  const displayPuts = optionChain ? filterStrikes(optionChain.puts, selectedPutStrike) : [];
  const displayCalls = optionChain ? filterStrikes(optionChain.calls, selectedCallStrike) : [];

  const hasData = displayPuts.length > 0 || displayCalls.length > 0;

  return (
    <div className="bg-charcoal rounded-2xl border border-white/10 shadow-lg overflow-hidden">
      {/* Header - Always visible */}
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/5 transition"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-silver" />
          ) : (
            <ChevronRight className="w-5 h-5 text-silver" />
          )}
          <h3 className="text-lg font-semibold">Option Chain</h3>
        </div>
        <div className="flex items-center gap-4 text-sm text-silver">
          <span>SPY ${underlyingPrice.toFixed(2)}</span>
          <span>|</span>
          <span>Exp: {expiration}</span>
          <span>|</span>
          <span>Target: 0.15-0.20</span>
        </div>
      </button>

      {/* Expandable Content */}
      {isExpanded && (
        <div className="px-6 pb-6">
          {!hasData ? (
            <div className="text-center py-8 text-silver">
              <p>No option chain data available</p>
              <p className="text-xs mt-2">Run analysis to fetch live data from IBKR</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-6">
              {/* PUTS Table */}
              <div>
                <h4 className="text-sm font-medium text-silver mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  PUTS
                </h4>
                <div className="overflow-hidden rounded-lg border border-white/10">
                  <table className="w-full text-sm">
                    <thead className="bg-white/5">
                      <tr className="text-left text-silver">
                        <th className="px-3 py-2 font-medium">Strike</th>
                        <th className="px-3 py-2 font-medium text-right">Bid</th>
                        <th className="px-3 py-2 font-medium text-right">Ask</th>
                        <th className="px-3 py-2 font-medium text-right">Delta</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {displayPuts.map((strike) => {
                        const isSelected = selectedPutStrike === strike.strike;
                        const inTargetRange = strike.delta >= 0.15 && strike.delta <= 0.20;
                        return (
                          <tr
                            key={strike.strike}
                            className={`
                              ${isSelected ? 'bg-red-500/20 font-medium' : ''}
                              ${inTargetRange && !isSelected ? 'bg-green-500/10' : ''}
                              hover:bg-white/5 transition
                            `}
                          >
                            <td className="px-3 py-2">
                              ${strike.strike}
                              {isSelected && <span className="ml-1 text-red-400">*</span>}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{strike.bid.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right font-mono">{strike.ask.toFixed(2)}</td>
                            <td className={`px-3 py-2 text-right font-mono ${inTargetRange ? 'text-green-400' : ''}`}>
                              {strike.delta.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                      {displayPuts.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-4 text-center text-silver">No put data</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* CALLS Table */}
              <div>
                <h4 className="text-sm font-medium text-silver mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  CALLS
                </h4>
                <div className="overflow-hidden rounded-lg border border-white/10">
                  <table className="w-full text-sm">
                    <thead className="bg-white/5">
                      <tr className="text-left text-silver">
                        <th className="px-3 py-2 font-medium">Strike</th>
                        <th className="px-3 py-2 font-medium text-right">Bid</th>
                        <th className="px-3 py-2 font-medium text-right">Ask</th>
                        <th className="px-3 py-2 font-medium text-right">Delta</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {displayCalls.map((strike) => {
                        const isSelected = selectedCallStrike === strike.strike;
                        const inTargetRange = strike.delta >= 0.15 && strike.delta <= 0.20;
                        return (
                          <tr
                            key={strike.strike}
                            className={`
                              ${isSelected ? 'bg-green-500/20 font-medium' : ''}
                              ${inTargetRange && !isSelected ? 'bg-green-500/10' : ''}
                              hover:bg-white/5 transition
                            `}
                          >
                            <td className="px-3 py-2">
                              ${strike.strike}
                              {isSelected && <span className="ml-1 text-green-400">*</span>}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{strike.bid.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right font-mono">{strike.ask.toFixed(2)}</td>
                            <td className={`px-3 py-2 text-right font-mono ${inTargetRange ? 'text-green-400' : ''}`}>
                              {strike.delta.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                      {displayCalls.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-4 text-center text-silver">No call data</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Legend */}
          {hasData && (
            <div className="mt-4 flex items-center gap-6 text-xs text-silver">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 bg-red-500/20 rounded"></span>
                <span>Selected PUT</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 bg-green-500/20 rounded"></span>
                <span>Selected CALL</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 bg-green-500/10 rounded"></span>
                <span>In target delta range (0.15-0.20)</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
