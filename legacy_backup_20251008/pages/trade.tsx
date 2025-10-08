import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import OptionChain from "../components/trade/option-chain";
import SpreadBuilder from "../components/trade/spread-builder";
import TradeValidationModal from "../components/trade/trade-validation-modal";
import { useWebSocket } from "@/hooks/use-websocket";
import type { TradeMode, FilterConfig } from "@/lib/types";
import type { OptionChainData, SpreadConfig } from "@shared/schema";

export default function Trade() {
  const { isConnected, lastMessage } = useWebSocket();
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [mode, setMode] = useState<TradeMode>('spy-0dte');
  const [filters, setFilters] = useState<FilterConfig>({
    symbol: 'SPY',
    expiration: 'today',
    deltaRange: '0.10-0.30',
    minOI: 100
  });
  const [selectedSpread, setSelectedSpread] = useState<SpreadConfig | null>(null);
  const [showValidation, setShowValidation] = useState(false);

  // Handle WebSocket price updates
  useEffect(() => {
    if (lastMessage?.type === 'price_update' && lastMessage.data) {
      const priceData = lastMessage.data;
      if (priceData[filters.symbol]) {
        setLivePrice(priceData[filters.symbol]);
        console.log('Received price update:', filters.symbol, priceData[filters.symbol]);
      }
    }
  }, [lastMessage, filters.symbol]);

  const { data: optionChain } = useQuery<OptionChainData>({
    queryKey: [`/api/options/chain/${filters.symbol}`, filters.expiration],
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const handleModeChange = (newMode: TradeMode) => {
    setMode(newMode);
    setFilters(prev => ({
      ...prev,
      symbol: newMode === 'spy-0dte' ? 'SPY' : 'TSLA',
      deltaRange: newMode === 'spy-0dte' ? '0.10-0.30' : '0.15-0.35',
      minOI: newMode === 'spy-0dte' ? 100 : 50
    }));
  };

  const handleBuildSpread = (strike: number) => {
    if (!optionChain) return;

    // Find the selected strike data
    const selectedOption = optionChain.options.find(opt => 
      opt.strike === strike && opt.type === 'put'
    );
    
    if (!selectedOption) return;

    // Create a default spread configuration
    const spreadConfig: SpreadConfig = {
      symbol: filters.symbol,
      strategy: 'put_credit',
      sellLeg: {
        strike: selectedOption.strike,
        type: 'put',
        action: 'sell',
        premium: selectedOption.ask,
        delta: selectedOption.delta,
        openInterest: selectedOption.openInterest
      },
      buyLeg: {
        strike: selectedOption.strike - 5, // Default 5-point spread
        type: 'put',
        action: 'buy',
        premium: 0.5, // Will be updated when user selects
        delta: -0.25,
        openInterest: 1000
      },
      quantity: 1,
      expiration: selectedOption.expiration
    };

    setSelectedSpread(spreadConfig);
  };

  const handlePreviewTrade = () => {
    if (selectedSpread) {
      setShowValidation(true);
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)]">
      {/* Main Trading Interface */}
      <div className="flex-1 p-6 space-y-6 overflow-auto">
        {/* Trade Mode Selector */}
        <div className="flex items-center space-x-4">
          <div className="flex bg-secondary rounded-lg p-1">
            <Button
              variant={mode === 'spy-0dte' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleModeChange('spy-0dte')}
              className={mode === 'spy-0dte' ? 'bg-primary text-primary-foreground' : ''}
              data-testid="button-spy-0dte"
            >
              SPY 0DTE
            </Button>
            <Button
              variant={mode === 'weekly-singles' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => handleModeChange('weekly-singles')}
              className={mode === 'weekly-singles' ? 'bg-primary text-primary-foreground' : ''}
              data-testid="button-weekly-singles"
            >
              Weekly Singles
            </Button>
          </div>
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
            <span>{isConnected ? 'Market Open' : 'Market Closed'}</span>
          </div>
        </div>

        {/* Option Chain Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="symbol">Symbol</Label>
                <Input
                  id="symbol"
                  value={filters.symbol}
                  onChange={(e) => setFilters(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
                  className="font-mono"
                  data-testid="input-symbol"
                />
              </div>
              <div>
                <Label htmlFor="expiration">Expiration</Label>
                <Select
                  value={filters.expiration}
                  onValueChange={(value) => setFilters(prev => ({ ...prev, expiration: value }))}
                >
                  <SelectTrigger data-testid="select-expiration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today (0DTE)</SelectItem>
                    <SelectItem value="2024-12-20">Dec 20, 2024</SelectItem>
                    <SelectItem value="2024-12-27">Dec 27, 2024</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="deltaRange">Delta Range</Label>
                <Select
                  value={filters.deltaRange}
                  onValueChange={(value) => setFilters(prev => ({ ...prev, deltaRange: value }))}
                >
                  <SelectTrigger data-testid="select-delta-range">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.10-0.30">0.10 - 0.30</SelectItem>
                    <SelectItem value="0.15-0.25">0.15 - 0.25</SelectItem>
                    <SelectItem value="0.20-0.40">0.20 - 0.40</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="minOI">Min OI</Label>
                <Input
                  id="minOI"
                  type="number"
                  value={filters.minOI}
                  onChange={(e) => setFilters(prev => ({ ...prev, minOI: parseInt(e.target.value) || 0 }))}
                  className="font-mono"
                  data-testid="input-min-oi"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Option Chain */}
        <OptionChain
          data={optionChain}
          filters={filters}
          onBuildSpread={handleBuildSpread}
          livePrice={livePrice}
        />
      </div>

      {/* Trade Drawer */}
      <SpreadBuilder
        spread={selectedSpread}
        onSpreadChange={setSelectedSpread}
        onPreviewTrade={handlePreviewTrade}
        onClear={() => setSelectedSpread(null)}
      />

      {/* Trade Validation Modal */}
      <TradeValidationModal
        isOpen={showValidation}
        onClose={() => setShowValidation(false)}
        spread={selectedSpread}
      />
    </div>
  );
}
