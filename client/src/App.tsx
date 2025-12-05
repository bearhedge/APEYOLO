import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Link, useLocation, Redirect } from "wouter";
import { CheckCircle, XCircle, LogOut } from "lucide-react";
import { Home } from "@/pages/Home";
import { Onboarding } from "@/pages/Onboarding";
import { Agent } from "@/pages/Agent";
import { Engine } from "@/pages/Engine";
import { Portfolio } from "@/pages/Portfolio";
import { Data } from "@/pages/Data";
import { Jobs } from "@/pages/Jobs";
import { Settings } from "@/pages/Settings";
import { getAccount, getDiag } from "@/lib/api";

function Navigation() {
  const [location] = useLocation();
  const isOnboarding = location.startsWith('/onboarding');

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
            {/* IBKR Status - green when connected, red when disconnected */}
            <div className="flex items-center gap-2" data-testid="ibkr-status">
              {isIBKRConnected ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500" />
              )}
              <span className={`text-sm ${isIBKRConnected ? 'text-green-500' : 'text-red-500'}`}>IBKR</span>
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
      <TooltipProvider>
        <Toaster />
        <div className="min-h-screen bg-background text-foreground">
          <Navigation />
          <Route path="/" component={Home} />
          <Route path="/onboarding" component={Onboarding} />
          <Route path="/agent" component={Agent} />
          <Route path="/engine" component={Engine} />
          <Route path="/portfolio" component={Portfolio} />
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
    </QueryClientProvider>
  );
}

export default App;
