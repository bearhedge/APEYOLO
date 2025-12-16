import { useState, useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Link, useLocation, Redirect } from "wouter";
import { CheckCircle, XCircle, LogOut, Clock, Wallet } from "lucide-react";
import { Home } from "@/pages/Home";
import { Onboarding } from "@/pages/Onboarding";
import { Agent } from "@/pages/Agent";
import { Engine } from "@/pages/Engine";
import { Portfolio } from "@/pages/Portfolio";
import { TrackRecord } from "@/pages/TrackRecord";
import { DeFi } from "@/pages/DeFi";
import { Data } from "@/pages/Data";
import { Jobs } from "@/pages/Jobs";
import { Settings } from "@/pages/Settings";
import { WalletProvider, useWalletContext } from "@/components/WalletProvider";
import { getAccount, getDiag } from "@/lib/api";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

// Wallet indicator component for nav bar
function WalletIndicator() {
  const { connected, publicKey, disconnect } = useWallet();
  const { cluster } = useWalletContext();
  const { setVisible } = useWalletModal();

  if (!connected || !publicKey) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="flex items-center gap-2 px-3 py-1.5 bg-charcoal border border-white/10 rounded-full hover:bg-dark-gray transition-colors"
      >
        <Wallet className="w-4 h-4 text-silver" />
        <span className="text-sm text-silver">Connect</span>
      </button>
    );
  }

  const address = publicKey.toBase58();
  const truncated = `${address.slice(0, 4)}..${address.slice(-4)}`;

  return (
    <button
      onClick={() => disconnect()}
      className="flex items-center gap-2 px-3 py-1.5 bg-charcoal border border-white/10 rounded-full hover:bg-dark-gray transition-colors group"
      title="Click to disconnect"
    >
      <span className="text-xs font-medium text-silver">SOL</span>
      <span className="text-sm font-mono">{truncated}</span>
      <span className={`w-2 h-2 rounded-full ${cluster === 'devnet' ? 'bg-yellow-400' : 'bg-green-400'}`} />
    </button>
  );
}

function Navigation() {
  const [location] = useLocation();
  const isOnboarding = location.startsWith('/onboarding');

  // NY time state - updates every minute
  const [nyTime, setNyTime] = useState(() =>
    new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
  );

  useEffect(() => {
    const updateTime = () => {
      setNyTime(new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }));
    };

    // Update every minute
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, []);

  const { data: account } = useQuery({
    queryKey: ['/api/account'],
    queryFn: getAccount,
    enabled: location !== '/' && !isOnboarding,
    refetchInterval: 10000, // Refresh every 10s for live NAV (matches IBKR status polling)
  });

  const { data: diagData } = useQuery({
    queryKey: ['/api/broker/diag'],
    queryFn: getDiag,
    enabled: location !== '/' && !isOnboarding,
    refetchInterval: 10000, // Refresh every 10s for connection status
  });

  // Logout handler - clears auth cookie and redirects to home
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.error('Logout error:', e);
    }
    window.location.href = '/';
  };

  if (location === "/" || isOnboarding) {
    return null;
  }

  // Check IBKR connection phases (oauth, sso, init must all be 200)
  const isIBKRConnected = diagData?.last?.oauth?.status === 200 &&
                          diagData?.last?.sso?.status === 200 &&
                          diagData?.last?.init?.status === 200;

  // NAV from IBKR account - use portfolioValue (netLiquidation)
  const nav = account?.portfolioValue || account?.netLiquidation || 0;

  return (
    <nav className="sticky top-0 z-10 bg-black border-b border-white/10">
      <div className="px-6">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex flex-col" data-testid="link-logo">
              <span className="text-xl font-bold tracking-wide">APEYOLO</span>
              <span className="text-[10px] text-silver tracking-wider -mt-1">THE SAFEST WAY TO YOLO.</span>
            </Link>
          </div>

          <div className="flex items-center gap-6">
            {/* Solana Wallet Indicator */}
            <WalletIndicator />

            {/* IBKR Status - green when connected, red when disconnected */}
            <div className="flex items-center gap-2" data-testid="ibkr-status">
              {isIBKRConnected ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500" />
              )}
              <span className={`text-sm ${isIBKRConnected ? 'text-green-500' : 'text-red-500'}`}>IBKR</span>
            </div>

            {/* NY Time */}
            <div className="flex items-center gap-1.5" data-testid="ny-time">
              <Clock className="w-4 h-4 text-silver" />
              <span className="text-sm text-silver tabular-nums">{nyTime} ET</span>
            </div>

            {/* NAV from IBKR */}
            <div className="flex items-center gap-2" data-testid="nav-display">
              <span className="text-sm text-silver">NAV</span>
              <span className="text-sm font-medium tabular-nums">
                ${nav > 0 ? nav.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'}
              </span>
            </div>

            {/* Logout button */}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm text-silver hover:text-white transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <TooltipProvider>
          <Toaster />
          <div className="min-h-screen bg-background text-foreground">
            <Navigation />
            <Route path="/" component={Home} />
            <Route path="/onboarding" component={Onboarding} />
            <Route path="/agent" component={Agent} />
            <Route path="/engine" component={Engine} />
            <Route path="/portfolio" component={Portfolio} />
            <Route path="/track-record" component={TrackRecord} />
            <Route path="/defi" component={DeFi} />
            <Route path="/data" component={Data} />
            <Route path="/jobs" component={Jobs} />
            <Route path="/settings" component={Settings} />
            {/* Redirects for old routes */}
            <Route path="/dashboard">
              <Redirect to="/agent" />
            </Route>
            <Route path="/sessions">
              <Redirect to="/agent" />
            </Route>
            <Route path="/trades">
              <Redirect to="/portfolio" />
            </Route>
          </div>
        </TooltipProvider>
      </WalletProvider>
    </QueryClientProvider>
  );
}

export default App;
