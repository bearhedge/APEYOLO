import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Play, Square, CheckCircle, XCircle, TrendingUp, Shield } from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { DataTable } from '@/components/DataTable';
import { SectionHeader } from '@/components/SectionHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getAccount, getAgentStatus, getPositions, startAgent, stopAgent } from '@/lib/api';
import { useStore } from '@/lib/store';
import type { Position } from '@shared/types';

export function Dashboard() {
  const [symbols, setSymbols] = useState('');
  const { googleConnected, ibkrConnected, aggression, maxLeverage, maxDailyLoss, maxPerSymbol, strategy, setStrategy } = useStore();

  const { data: account } = useQuery({
    queryKey: ['/api/account'],
    queryFn: getAccount,
  });

  const { data: agentStatus, refetch: refetchAgentStatus } = useQuery({
    queryKey: ['/api/agent/status'],
    queryFn: getAgentStatus,
  });

  const { data: positions } = useQuery<Position[]>({
    queryKey: ['/api/positions'],
    queryFn: getPositions,
  });

  const startMutation = useMutation({
    mutationFn: () => startAgent({ strategy, symbols: symbols.split(',').map(s => s.trim()) }),
    onSuccess: () => refetchAgentStatus(),
  });

  const stopMutation = useMutation({
    mutationFn: stopAgent,
    onSuccess: () => refetchAgentStatus(),
  });

  const positionColumns = [
    { header: 'Symbol', accessor: 'symbol' as keyof Position, sortable: true },
    { header: 'Side', accessor: 'side' as keyof Position, sortable: true },
    { header: 'Qty', accessor: 'qty' as keyof Position, sortable: true, className: 'tabular-nums' },
    { header: 'Avg', accessor: (row: Position) => `$${row.avg.toFixed(2)}`, className: 'tabular-nums' },
    { header: 'Mark', accessor: (row: Position) => `$${row.mark.toFixed(2)}`, className: 'tabular-nums' },
    { 
      header: 'P/L$', 
      accessor: (row: Position) => (
        <span className={row.upl >= 0 ? 'text-green-500' : 'text-red-500'}>
          ${row.upl.toFixed(2)}
        </span>
      ),
      className: 'tabular-nums'
    },
    { 
      header: 'P/L%', 
      accessor: (row: Position) => {
        const pct = (row.upl / (row.avg * row.qty)) * 100;
        return (
          <span className={pct >= 0 ? 'text-green-500' : 'text-red-500'}>
            {pct.toFixed(2)}%
          </span>
        );
      },
      className: 'tabular-nums'
    },
  ];

  const marginUsedPct = account ? (account.marginUsed || 0) : 0;

  return (
    <div className="p-6 space-y-6">
      <SectionHeader
        title="Dashboard"
        subtitle="Command center for automated options trading"
        testId="header-dashboard"
      />

      {/* Connection & Agent Control Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Connection Status */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Connection Status</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-silver">Google Account</span>
              {googleConnected ? (
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-sm text-green-500">Connected</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-500" />
                  <span className="text-sm text-red-500">Not Connected</span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-silver">IBKR Broker</span>
              {ibkrConnected ? (
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-sm text-green-500">Connected</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-500" />
                  <span className="text-sm text-red-500">Not Connected</span>
                </div>
              )}
            </div>
            <Button
              onClick={() => getAccount()}
              className="btn-secondary w-full mt-4"
              data-testid="button-test-connection"
            >
              Test Connection
            </Button>
          </div>
        </div>

        {/* Agent Control */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Agent Control</h3>
          <div className="space-y-4">
            <div>
              <Label htmlFor="strategy">Strategy</Label>
              <Select value={strategy} onValueChange={setStrategy}>
                <SelectTrigger className="input-monochrome mt-1" data-testid="select-strategy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-charcoal border-white/10">
                  <SelectItem value="CSP">Cash-Secured Puts (CSP)</SelectItem>
                  <SelectItem value="CC">Covered Calls (CC)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="symbols">Symbols (comma-separated)</Label>
              <Input
                id="symbols"
                value={symbols}
                onChange={(e) => setSymbols(e.target.value)}
                placeholder="SPY, QQQ, IWM"
                className="input-monochrome mt-1"
                data-testid="input-symbols"
              />
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => startMutation.mutate()}
                disabled={!symbols || startMutation.isPending || agentStatus?.status === 'running'}
                className="btn-primary flex-1"
                data-testid="button-start-agent"
              >
                <Play className="w-4 h-4 mr-2" />
                Start
              </Button>
              <Button
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending || agentStatus?.status !== 'running'}
                className="btn-secondary flex-1"
                data-testid="button-stop-agent"
              >
                <Square className="w-4 h-4 mr-2" />
                Stop
              </Button>
            </div>

            <div className="pt-3 border-t border-white/10">
              <p className="text-sm text-silver">
                Status:{' '}
                <span className={`font-medium ${
                  agentStatus?.status === 'running' ? 'text-green-500' :
                  agentStatus?.status === 'error' ? 'text-red-500' :
                  'text-silver'
                }`} data-testid="text-agent-status">
                  {agentStatus?.status?.toUpperCase() || 'STOPPED'}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Risk Snapshot */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5" />
            <h3 className="text-lg font-semibold">Risk Snapshot</h3>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-silver">Aggression</span>
              <span className="font-medium">{aggression}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-silver">Max Leverage</span>
              <span className="font-medium">{maxLeverage}x</span>
            </div>
            <div className="flex justify-between">
              <span className="text-silver">Max Daily Loss</span>
              <span className="font-medium">{maxDailyLoss}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-silver">Per-Symbol Cap</span>
              <span className="font-medium">${maxPerSymbol.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Account Overview */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5" />
            <h3 className="text-lg font-semibold">Account Overview</h3>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-silver">NAV</span>
              <span className="font-medium tabular-nums">${account?.nav?.toLocaleString() || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-silver">Buying Power</span>
              <span className="font-medium tabular-nums">${account?.buyingPower?.toLocaleString() || '0'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-silver">Margin Used</span>
              <span className={`font-medium tabular-nums ${
                marginUsedPct > 70 ? 'text-red-500' : marginUsedPct > 50 ? 'text-amber-500' : 'text-green-500'
              }`}>
                {marginUsedPct.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-silver">Open Positions</span>
              <span className="font-medium tabular-nums">{positions?.length || 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Open Positions Table */}
      <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
        <h3 className="text-lg font-semibold mb-4">Open Positions</h3>
        {positions && positions.length > 0 ? (
          <DataTable
            data={positions}
            columns={positionColumns}
            testId="table-open-positions"
          />
        ) : (
          <div className="text-center py-12">
            <p className="text-silver">No open positions</p>
          </div>
        )}
      </div>
    </div>
  );
}
