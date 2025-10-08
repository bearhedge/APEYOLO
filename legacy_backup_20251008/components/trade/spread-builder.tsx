import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SpreadConfig } from "@shared/schema";

interface SpreadBuilderProps {
  spread: SpreadConfig | null;
  onSpreadChange: (spread: SpreadConfig | null) => void;
  onPreviewTrade: () => void;
  onClear: () => void;
}

export default function SpreadBuilder({ 
  spread, 
  onSpreadChange, 
  onPreviewTrade, 
  onClear 
}: SpreadBuilderProps) {
  const isOpen = spread !== null;

  const updateSpread = (updates: Partial<SpreadConfig>) => {
    if (spread) {
      onSpreadChange({ ...spread, ...updates });
    }
  };

  const updateBuyLeg = (updates: Partial<SpreadConfig['buyLeg']>) => {
    if (spread) {
      onSpreadChange({
        ...spread,
        buyLeg: { ...spread.buyLeg, ...updates }
      });
    }
  };

  if (!spread) {
    return (
      <div className={cn(
        "trade-drawer w-96 bg-card border-l border-border flex flex-col",
        !isOpen && "trade-drawer"
      )}>
        <div className="p-8 text-center text-muted-foreground">
          <p>Select an option from the chain to build a spread</p>
        </div>
      </div>
    );
  }

  const netCredit = spread.sellLeg.premium - spread.buyLeg.premium;
  const maxProfit = netCredit * 100 * spread.quantity;
  const spreadWidth = Math.abs(spread.sellLeg.strike - spread.buyLeg.strike);
  const maxLoss = (spreadWidth - netCredit) * 100 * spread.quantity;
  const breakeven = spread.sellLeg.strike - netCredit;
  const netDelta = (spread.sellLeg.delta + spread.buyLeg.delta) * spread.quantity;
  const marginRequired = spreadWidth * 100 * spread.quantity;

  return (
    <div className={cn(
      "trade-drawer w-96 bg-card border-l border-border flex flex-col",
      isOpen && "open"
    )}>
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h3 className="text-lg font-semibold">Build Credit Spread</h3>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onClear}
          data-testid="button-close-drawer"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Spread Configuration */}
        <div className="space-y-4">
          <div>
            <Label htmlFor="strategy">Spread Type</Label>
            <Select
              value={spread.strategy}
              onValueChange={(value: 'put_credit' | 'call_credit') => 
                updateSpread({ strategy: value })
              }
            >
              <SelectTrigger data-testid="select-strategy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="put_credit">Put Credit Spread</SelectItem>
                <SelectItem value="call_credit">Call Credit Spread</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Leg Configuration */}
          <div className="space-y-3">
            <div className="bg-secondary/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-green-400">SELL Leg</span>
                <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30">
                  Short
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Strike:</span>
                  <div className="font-mono">{spread.sellLeg.strike}{spread.sellLeg.type.toUpperCase().charAt(0)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Premium:</span>
                  <div className="font-mono">${spread.sellLeg.premium.toFixed(2)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Delta:</span>
                  <div className="font-mono">{spread.sellLeg.delta.toFixed(2)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">OI:</span>
                  <div className="font-mono">
                    {spread.sellLeg.openInterest > 1000 
                      ? `${(spread.sellLeg.openInterest/1000).toFixed(1)}K` 
                      : spread.sellLeg.openInterest
                    }
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-secondary/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-red-400">BUY Leg</span>
                <Badge variant="outline" className="bg-red-500/20 text-red-400 border-red-500/30">
                  Long
                </Badge>
              </div>
              <div className="space-y-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Select Strike</Label>
                  <Select
                    value={spread.buyLeg.strike.toString()}
                    onValueChange={(value) => {
                      const strike = parseFloat(value);
                      // Update premium based on strike (simplified)
                      const premium = Math.max(0.01, spread.sellLeg.premium - (spread.sellLeg.strike - strike) * 0.1);
                      updateBuyLeg({ strike, premium });
                    }}
                  >
                    <SelectTrigger className="font-mono text-sm" data-testid="select-buy-strike">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Generate strike options */}
                      {Array.from({ length: 5 }, (_, i) => {
                        const strike = spread.sellLeg.strike - (i + 1) * 5;
                        const premium = Math.max(0.01, spread.sellLeg.premium - (i + 1) * 0.2);
                        return (
                          <SelectItem key={strike} value={strike.toString()}>
                            {strike}{spread.sellLeg.type.toUpperCase().charAt(0)} (${premium.toFixed(2)})
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Delta:</span>
                    <div className="font-mono">{spread.buyLeg.delta.toFixed(2)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">OI:</span>
                    <div className="font-mono">
                      {spread.buyLeg.openInterest > 1000 
                        ? `${(spread.buyLeg.openInterest/1000).toFixed(1)}K` 
                        : spread.buyLeg.openInterest
                      }
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quantity */}
          <div>
            <Label htmlFor="quantity">Contracts</Label>
            <Input
              id="quantity"
              type="number"
              value={spread.quantity}
              onChange={(e) => updateSpread({ quantity: parseInt(e.target.value) || 1 })}
              min={1}
              className="font-mono"
              data-testid="input-quantity"
            />
          </div>
        </div>

        {/* Spread Analysis */}
        <Card className="bg-accent/10">
          <CardContent className="p-4">
            <h4 className="font-medium mb-3">Spread Analysis</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Net Credit:</span>
                <span className="font-mono text-green-400" data-testid="text-net-credit">
                  ${netCredit.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Max Profit:</span>
                <span className="font-mono" data-testid="text-max-profit">
                  ${maxProfit.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Max Loss:</span>
                <span className="font-mono text-red-400" data-testid="text-max-loss">
                  ${maxLoss.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Breakeven:</span>
                <span className="font-mono">{breakeven.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Net Delta:</span>
                <span className="font-mono">{netDelta.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Margin Req:</span>
                <span className="font-mono">${marginRequired.toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action Buttons */}
      <div className="p-4 border-t border-border space-y-3">
        <Button 
          className="w-full" 
          onClick={onPreviewTrade}
          data-testid="button-preview-trade"
        >
          Preview Trade
        </Button>
        <Button 
          variant="outline" 
          className="w-full" 
          onClick={onClear}
          data-testid="button-clear"
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
