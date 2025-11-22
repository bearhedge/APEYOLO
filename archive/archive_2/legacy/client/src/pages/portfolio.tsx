import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Position } from "@shared/schema";

export default function Portfolio() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: positions = [] } = useQuery<Position[]>({
    queryKey: ['/api/positions'],
    refetchInterval: 30000,
  });

  const closePositionMutation = useMutation({
    mutationFn: async (positionId: string) => {
      return apiRequest('POST', `/api/positions/${positionId}/close`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/positions'] });
      toast({
        title: "Position Closed",
        description: "Position has been successfully closed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to close position. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleClosePosition = (positionId: string) => {
    closePositionMutation.mutate(positionId);
  };

  const handleRollPosition = (positionId: string) => {
    // TODO: Implement roll functionality
    toast({
      title: "Roll Position",
      description: "Roll functionality coming soon.",
    });
  };

  // Calculate metrics
  const totalPositions = positions.length;
  const unrealizedPnL = positions.reduce((sum, pos) => {
    const currentVal = parseFloat(pos.currentValue.toString());
    const openCredit = parseFloat(pos.openCredit.toString());
    return sum + (openCredit - currentVal);
  }, 0);

  const portfolioDelta = positions.reduce((sum, pos) => {
    return sum + parseFloat(pos.delta.toString());
  }, 0);

  const marginUsed = positions.reduce((sum, pos) => {
    return sum + parseFloat(pos.marginRequired.toString());
  }, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Portfolio Summary */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">Open Positions</h2>
            <div className="flex items-center space-x-4 text-sm">
              <div>
                <span className="text-muted-foreground">Total Positions:</span>
                <span className="font-mono ml-2" data-testid="text-total-positions">{totalPositions}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Unrealized P&L:</span>
                <span className={`font-mono ml-2 ${unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`} data-testid="text-unrealized-pnl">
                  {unrealizedPnL >= 0 ? '+' : ''}${unrealizedPnL.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Positions Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50">
                <tr>
                  <th className="px-4 py-3 text-left">Symbol</th>
                  <th className="px-4 py-3 text-left">Strategy</th>
                  <th className="px-4 py-3 text-right">Strikes</th>
                  <th className="px-4 py-3 text-right">Expiration</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Credit</th>
                  <th className="px-4 py-3 text-right">Current</th>
                  <th className="px-4 py-3 text-right">P&L</th>
                  <th className="px-4 py-3 text-right">Delta</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {positions.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                      No open positions
                    </td>
                  </tr>
                ) : (
                  positions.map((position) => {
                    const pnl = parseFloat(position.openCredit.toString()) - parseFloat(position.currentValue.toString());
                    return (
                      <tr 
                        key={position.id} 
                        className="border-b border-border hover:bg-secondary/30 transition-colors"
                        data-testid={`row-position-${position.id}`}
                      >
                        <td className="px-4 py-3 font-mono font-medium">{position.symbol}</td>
                        <td className="px-4 py-3">
                          <Badge 
                            variant="outline" 
                            className="bg-green-500/20 text-green-400 border-green-500/30"
                          >
                            {position.strategy.replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-mono text-right">
                          {position.sellStrike}/{position.buyStrike}
                        </td>
                        <td className="px-4 py-3 font-mono text-right">
                          {new Date(position.expiration).toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric' 
                          })}
                        </td>
                        <td className="px-4 py-3 font-mono text-right">{position.quantity}</td>
                        <td className="px-4 py-3 font-mono text-right text-green-400">
                          ${parseFloat(position.openCredit.toString()).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 font-mono text-right">
                          ${parseFloat(position.currentValue.toString()).toFixed(2)}
                        </td>
                        <td className={`px-4 py-3 font-mono text-right ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 font-mono text-right">
                          {parseFloat(position.delta.toString()).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex justify-center space-x-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleClosePosition(position.id)}
                              disabled={closePositionMutation.isPending}
                              className="px-2 py-1 text-xs bg-primary/20 text-primary border-primary/30 hover:bg-primary/30"
                              data-testid={`button-close-${position.id}`}
                            >
                              Close
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRollPosition(position.id)}
                              className="px-2 py-1 text-xs bg-accent/20 text-accent border-accent/30 hover:bg-accent/30"
                              data-testid={`button-roll-${position.id}`}
                            >
                              Roll
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Risk Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold mb-4">Risk Metrics</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Portfolio Delta</span>
                <span className="font-mono" data-testid="text-portfolio-delta">{portfolioDelta.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Delta Limit</span>
                <span className="font-mono text-muted-foreground">±2.50</span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2">
                <div 
                  className="bg-primary h-2 rounded-full transition-all duration-500" 
                  style={{ width: `${Math.min(Math.abs(portfolioDelta) / 2.5 * 100, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-muted-foreground">Margin Used</span>
                <span className="font-mono" data-testid="text-margin-used">${marginUsed.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Available Margin</span>
                <span className="font-mono text-primary">$10,980.50</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold mb-4">Performance</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Today's P&L</span>
                <span className="font-mono text-green-400">+$1,234.56</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Week P&L</span>
                <span className="font-mono text-green-400">+$3,890.12</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Month P&L</span>
                <span className="font-mono text-green-400">+$12,450.89</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Win Rate</span>
                <span className="font-mono">78.5%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Avg Hold Time</span>
                <span className="font-mono">2.3 days</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
