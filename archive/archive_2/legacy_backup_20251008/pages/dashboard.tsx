import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Wallet, 
  BarChart3, 
  Scale, 
  TrendingUp 
} from "lucide-react";
import type { AccountInfo, Position, Trade } from "@shared/schema";
import { useWebSocket } from "@/hooks/use-websocket";

export default function Dashboard() {
  const { isConnected } = useWebSocket();
  
  const { data: account } = useQuery<AccountInfo>({
    queryKey: ['/api/account'],
    refetchInterval: 30000,
  });

  const { data: positions = [] } = useQuery<Position[]>({
    queryKey: ['/api/positions'],
    refetchInterval: 30000,
  });

  const { data: trades = [] } = useQuery<Trade[]>({
    queryKey: ['/api/trades'],
    refetchInterval: 30000,
  });

  // Calculate derived metrics
  const openPositions = positions.length;
  const spyPositions = positions.filter(p => p.symbol === 'SPY').length;
  const totalPositions = Math.max(openPositions, 1);
  const spyAllocation = (spyPositions / totalPositions) * 100;
  const weeklyAllocation = 100 - spyAllocation;
  
  // Recent trades (last 3)
  const recentTrades = trades
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
    .slice(0, 3);

  return (
    <div className="p-6 space-y-6">
      {/* Portfolio Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Portfolio Value</p>
                <p className="text-2xl font-semibold" data-testid="text-portfolio-value">
                  ${account?.portfolioValue?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
                </p>
              </div>
              <div className="p-3 bg-primary/10 rounded-lg">
                <Wallet className="h-5 w-5 text-primary" />
              </div>
            </div>
            <div className="mt-4 flex items-center text-sm">
              <span className="text-green-400">+2.34%</span>
              <span className="text-muted-foreground ml-2">vs yesterday</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Open Positions</p>
                <p className="text-2xl font-semibold" data-testid="text-open-positions">
                  {openPositions}
                </p>
              </div>
              <div className="p-3 bg-accent/10 rounded-lg">
                <BarChart3 className="h-5 w-5 text-accent" />
              </div>
            </div>
            <div className="mt-4 flex items-center text-sm">
              <span className="text-muted-foreground">{openPositions} Credit Spreads</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Net Delta</p>
                <p className="text-2xl font-semibold" data-testid="text-net-delta">
                  {account?.netDelta?.toFixed(2) || '0.00'}
                </p>
              </div>
              <div className="p-3 bg-yellow-500/10 rounded-lg">
                <Scale className="h-5 w-5 text-yellow-500" />
              </div>
            </div>
            <div className="mt-4 flex items-center text-sm">
              <span className="text-muted-foreground">Within limits</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Day P&L</p>
                <p className="text-2xl font-semibold text-green-400" data-testid="text-day-pnl">
                  +${account?.dayPnL?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
                </p>
              </div>
              <div className="p-3 bg-green-500/10 rounded-lg">
                <TrendingUp className="h-5 w-5 text-green-500" />
              </div>
            </div>
            <div className="mt-4 flex items-center text-sm">
              <span className="text-green-400">+0.97%</span>
              <span className="text-muted-foreground ml-2">today</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity & Key Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Trades */}
        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold mb-4">Recent Trades</h3>
            <div className="space-y-3">
              {recentTrades.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  No recent trades
                </div>
              ) : (
                recentTrades.map((trade) => (
                  <div 
                    key={trade.id} 
                    className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
                    data-testid={`trade-${trade.id}`}
                  >
                    <div>
                      <div className="font-mono text-sm">
                        {trade.symbol} {trade.sellStrike}/{trade.buyStrike}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {trade.strategy.replace('_', ' ')} • ${trade.credit} credit
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-green-400">
                        +${trade.credit}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(trade.submittedAt).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit'
                        })}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Portfolio Allocation */}
        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold mb-4">Portfolio Allocation</h3>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm">SPY 0DTE</span>
                  <span className="text-sm font-mono">{spyAllocation.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2">
                  <div 
                    className="bg-primary h-2 rounded-full transition-all duration-500" 
                    style={{ width: `${spyAllocation}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm">Weekly Singles</span>
                  <span className="text-sm font-mono">{weeklyAllocation.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2">
                  <div 
                    className="bg-accent h-2 rounded-full transition-all duration-500" 
                    style={{ width: `${weeklyAllocation}%` }}
                  />
                </div>
              </div>
              <div className="pt-4 border-t border-border">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Max Delta Exposure:</span>
                    <div className="font-mono">±2.50</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Capital Utilization:</span>
                    <div className="font-mono">
                      {account ? ((account.marginUsed / (account.buyingPower + account.marginUsed)) * 100).toFixed(0) : 0}%
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Market Status */}
      <div className="flex items-center justify-center space-x-2 text-sm">
        <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
        <span className="text-muted-foreground">
          {isConnected ? 'Live Data Connected' : 'Data Connection Lost'}
        </span>
      </div>
    </div>
  );
}
