import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Link, useLocation, Redirect } from "wouter";
import { CheckCircle, XCircle } from "lucide-react";
import { Home } from "@/pages/Home";
import { Onboarding } from "@/pages/Onboarding";
import { Agent } from "@/pages/Agent";
import { Engine } from "@/pages/Engine";
import { Portfolio } from "@/pages/Portfolio";
import { Trades } from "@/pages/Trades";
import { Jobs } from "@/pages/Jobs";
import { PNL } from "@/pages/PNL";
import { Settings } from "@/pages/Settings";
import { getAccount, getDiag } from "@/lib/api";

function Navigation() {
  const [location] = useLocation();
  const isOnboarding = location.startsWith('/onboarding');

  const { data: account } = useQuery({
    queryKey: ['/api/account'],
    queryFn: getAccount,
    enabled: location !== '/' && !isOnboarding,
  });

  const { data: diagData } = useQuery({
    queryKey: ['/api/broker/diag'],
    queryFn: getDiag,
    enabled: location !== '/' && !isOnboarding,
  });

  if (location === "/" || isOnboarding) {
    return null;
  }

  const isIBKRConnected = diagData?.oauth === 200 && diagData?.sso === 200;

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
            {/* IBKR Status */}
            <div className="flex items-center gap-2" data-testid="ibkr-status">
              {isIBKRConnected ? (
                <CheckCircle className="w-4 h-4 text-white" />
              ) : (
                <XCircle className="w-4 h-4 text-silver" />
              )}
              <span className="text-sm text-silver">IBKR</span>
            </div>

            {/* DeFi Bridge */}
            <div className="flex items-center gap-2" data-testid="defi-bridge">
              <div className="w-2 h-2 rounded-full bg-silver" />
              <span className="text-sm text-silver">Bridge</span>
            </div>

            {/* NAV */}
            <div className="flex items-center gap-2" data-testid="nav-display">
              <span className="text-sm text-silver">NAV</span>
              <span className="text-sm font-medium tabular-nums">
                ${account?.nav?.toLocaleString() || '0'}
              </span>
            </div>
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
          <Route path="/trades" component={Trades} />
          <Route path="/jobs" component={Jobs} />
          <Route path="/pnl" component={PNL} />
          <Route path="/settings" component={Settings} />
          {/* Redirects for old routes */}
          <Route path="/dashboard">
            <Redirect to="/agent" />
          </Route>
          <Route path="/sessions">
            <Redirect to="/agent" />
          </Route>
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
