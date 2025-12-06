import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, LogOut, Zap, XCircle, RefreshCw, Clock } from "lucide-react";
import type { AccountInfo } from "@/lib/types";
import { useBrokerStatus } from "@/hooks/useBrokerStatus";

type MarketStatus = 'WEEKEND' | 'PRE-MARKET' | 'TRADING' | 'AFTER-HOURS' | 'CLOSED';

/**
 * Get market status based on current Eastern time
 */
function getMarketStatus(now: Date): { status: MarketStatus; label: string } {
  // Get Eastern time components
  const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const etDate = new Date(etString);
  const dayOfWeek = etDate.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = etDate.getHours();
  const minute = etDate.getMinutes();
  const timeInMinutes = hour * 60 + minute;

  // Weekend check
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { status: 'WEEKEND', label: 'Weekend' };
  }

  // Market hours: 9:30 AM - 4:00 PM ET
  const marketOpen = 9 * 60 + 30;   // 9:30 AM = 570 minutes
  const marketClose = 16 * 60;       // 4:00 PM = 960 minutes

  if (timeInMinutes < marketOpen) {
    return { status: 'PRE-MARKET', label: 'Pre-Market' };
  } else if (timeInMinutes >= marketOpen && timeInMinutes < marketClose) {
    return { status: 'TRADING', label: 'Market Open' };
  } else {
    return { status: 'AFTER-HOURS', label: 'After Hours' };
  }
}

/**
 * Get current time in Eastern Time with market status
 */
function useEasternTime() {
  const [state, setState] = useState(() => {
    const now = new Date();
    return {
      time: now.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }),
      marketStatus: getMarketStatus(now),
    };
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setState({
        time: now.toLocaleTimeString('en-US', {
          timeZone: 'America/New_York',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }),
        marketStatus: getMarketStatus(now),
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return state;
}

export default function AppHeader() {
  const queryClient = useQueryClient();
  const easternTime = useEasternTime();

  const { data: account } = useQuery<AccountInfo>({
    queryKey: ['/api/account'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Unified broker status - same query key as Engine and Settings
  const { connected: brokerConnected, isConnecting } = useBrokerStatus();

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Logout failed');
      return response.json();
    },
    onSuccess: () => {
      // Clear all cached data and redirect to home
      queryClient.clear();
      window.location.href = '/';
    },
  });

  const handleLogout = () => {
    if (confirm('Are you sure you want to logout?')) {
      logoutMutation.mutate();
    }
  };

  return (
    <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <i className="fas fa-water text-primary text-xl"></i>
          <span className="text-xl font-semibold">Orca Options</span>
        </div>
        <div className="text-sm text-muted-foreground">Professional Trading Platform</div>
      </div>
      <div className="flex items-center space-x-4">
        {/* Eastern Time + Market Status */}
        <div className="text-sm flex items-center gap-2" data-testid="eastern-time">
          <Clock className="h-3.5 w-3.5 text-zinc-400" />
          <span className="font-mono text-zinc-300">{easternTime.time}</span>
          <span className="text-zinc-500 text-xs">ET</span>
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
            easternTime.marketStatus.status === 'TRADING'
              ? 'bg-green-500/20 text-green-400'
              : easternTime.marketStatus.status === 'PRE-MARKET'
              ? 'bg-yellow-500/20 text-yellow-400'
              : easternTime.marketStatus.status === 'AFTER-HOURS'
              ? 'bg-orange-500/20 text-orange-400'
              : 'bg-zinc-500/20 text-zinc-400'
          }`}>
            {easternTime.marketStatus.label}
          </span>
        </div>

        {/* IBKR Status - synced with Engine and Settings */}
        <div className="text-sm flex items-center gap-1.5" data-testid="ibkr-status">
          {isConnecting ? (
            <RefreshCw className="h-3.5 w-3.5 text-yellow-500 animate-spin" />
          ) : brokerConnected ? (
            <Zap className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <XCircle className="h-3.5 w-3.5 text-red-500" />
          )}
          <span className={`font-medium ${brokerConnected ? 'text-green-500' : isConnecting ? 'text-yellow-500' : 'text-red-500'}`}>
            {isConnecting ? 'Connecting...' : brokerConnected ? 'IBKR' : 'Disconnected'}
          </span>
        </div>
        <div className="text-sm" data-testid="account-number">
          <span className="text-muted-foreground">Account:</span>
          <span className="font-mono ml-1">{account?.accountNumber || 'Loading...'}</span>
        </div>
        <div className="text-sm" data-testid="buying-power">
          <span className="text-muted-foreground">Buying Power:</span>
          <span className="font-mono text-primary ml-1">
            ${account?.buyingPower?.toLocaleString('en-US', { minimumFractionDigits: 2 }) || '0.00'}
          </span>
        </div>
        <button
          className="p-2 rounded-md hover:bg-secondary transition-colors"
          data-testid="button-settings"
        >
          <Settings className="h-4 w-4" />
        </button>
        <button
          onClick={handleLogout}
          disabled={logoutMutation.isPending}
          className="p-2 rounded-md hover:bg-red-900/30 hover:text-red-400 transition-colors disabled:opacity-50"
          title="Logout"
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
