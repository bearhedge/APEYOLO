import { useQuery } from '@tanstack/react-query';
import { CheckCircle, XCircle, TrendingUp, Shield, Clock, AlertTriangle } from 'lucide-react';
import { getAccount, getDiag } from '@/lib/api';
import { useStore } from '@/lib/store';
import { useLocation } from 'wouter';
import { AgentContextPanel } from './AgentContextPanel';

interface ContextCard {
  title: string;
  icon: React.ReactNode;
  content: React.ReactNode;
}

export function ContextPanel() {
  const [location] = useLocation();

  // Show agent-specific panel on /agent route
  if (location === '/agent') {
    return <AgentContextPanel />;
  }

  const { data: account } = useQuery({
    queryKey: ['/api/account'],
    queryFn: getAccount,
    enabled: location !== '/' && location !== '/onboarding',
  });

  const { data: diagData } = useQuery({
    queryKey: ['/api/broker/diag'],
    queryFn: getDiag,
    enabled: location !== '/' && location !== '/onboarding',
  });

  const { aggression, maxLeverage, maxDailyLoss, maxPerSymbol } = useStore();

  const isIBKRConnected = diagData?.oauth === 200 && diagData?.sso === 200;

  const cards: ContextCard[] = [
    {
      title: 'Session',
      icon: <CheckCircle className="w-4 h-4" />,
      content: (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-silver">IBKR</span>
            {isIBKRConnected ? (
              <span className="flex items-center gap-1 text-xs font-medium">
                <CheckCircle className="w-3 h-3" />
                Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-medium text-silver">
                <XCircle className="w-3 h-3" />
                Disconnected
              </span>
            )}
          </div>
          <div className="flex justify-between items-center">
            <span className="text-silver">Oracle</span>
            <span className="flex items-center gap-1 text-xs font-medium">
              <CheckCircle className="w-3 h-3" />
              Live
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-silver">Mode</span>
            <span className="text-xs font-medium tabular-nums">{aggression}% Aggression</span>
          </div>
        </div>
      ),
    },
    {
      title: 'Portfolio',
      icon: <TrendingUp className="w-4 h-4" />,
      content: (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-silver">NAV</span>
            <span className="font-medium tabular-nums">${account?.nav?.toLocaleString() || '0'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-silver">Day P/L</span>
            <span className="font-medium tabular-nums">+$0.00</span>
          </div>
          <div className="flex justify-between">
            <span className="text-silver">Buying Power</span>
            <span className="font-medium tabular-nums">${account?.buyingPower?.toLocaleString() || '0'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-silver">Utilization</span>
            <span className="font-medium tabular-nums">{account?.marginUsed || 0}%</span>
          </div>
        </div>
      ),
    },
    {
      title: 'Risk',
      icon: <Shield className="w-4 h-4" />,
      content: (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-silver">|Δ| vs Cap</span>
            <span className="font-medium tabular-nums">0 / 100</span>
          </div>
          <div className="flex justify-between">
            <span className="text-silver">VaR(1d)</span>
            <span className="font-medium tabular-nums">$0 / $5k</span>
          </div>
          <div className="flex justify-between">
            <span className="text-silver">30d Drawdown</span>
            <span className="font-medium tabular-nums">0% / {maxDailyLoss}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-silver">Status</span>
            <span className="font-medium">All limits OK</span>
          </div>
        </div>
      ),
    },
    {
      title: 'Allocation',
      icon: <TrendingUp className="w-4 h-4" />,
      content: (
        <div className="text-center py-6">
          <p className="text-sm text-silver">No active allocations</p>
        </div>
      ),
    },
    {
      title: 'Queue',
      icon: <Clock className="w-4 h-4" />,
      content: (
        <div className="text-center py-6">
          <p className="text-sm text-silver">No scheduled actions</p>
        </div>
      ),
    },
    {
      title: 'Alerts',
      icon: <AlertTriangle className="w-4 h-4" />,
      content: (
        <div className="text-center py-6">
          <p className="text-sm text-silver">All systems operational</p>
        </div>
      ),
    },
  ];

  return (
    <div className="w-96 bg-charcoal border-l border-white/20 overflow-y-auto">
      <div className="p-4 space-y-4">
        {cards.map((card, index) => (
          <div
            key={card.title}
            className="bg-dark-gray p-4 border border-white/20"
            data-testid={`context-card-${card.title.toLowerCase()}`}
          >
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
              {card.icon}
              <h3 className="text-xs font-semibold uppercase tracking-wider">{card.title}</h3>
            </div>
            {card.content}
          </div>
        ))}
      </div>
    </div>
  );
}
