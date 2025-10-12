import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Link, useLocation } from "wouter";
import { Home as HomeIcon, LayoutDashboard, TrendingUp, Settings as SettingsIcon, MessageSquare } from "lucide-react";
import { Home } from "@/pages/Home";
import { Onboarding } from "@/pages/Onboarding";
import { Dashboard } from "@/pages/Dashboard";
import { PNL } from "@/pages/PNL";
import { Settings } from "@/pages/Settings";
import { Sessions } from "@/pages/Sessions";

function Navigation() {
  const [location] = useLocation();

  const links = [
    { path: "/", label: "Home", icon: HomeIcon },
    { path: "/sessions", label: "Sessions", icon: MessageSquare },
    { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { path: "/pnl", label: "PNL", icon: TrendingUp },
    { path: "/settings", label: "Settings", icon: SettingsIcon },
  ];

  if (location === "/" || location === "/onboarding") {
    return null;
  }

  return (
    <nav className="sticky top-0 z-10 bg-black border-b border-white/10">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link href="/">
              <a className="text-xl font-bold" data-testid="link-logo">
                ApeX Options
              </a>
            </Link>
            <div className="hidden md:flex items-center gap-1">
              {links.slice(1).map((link) => {
                const Icon = link.icon;
                const isActive = location === link.path;
                return (
                  <Link key={link.path} href={link.path}>
                    <a
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                        isActive
                          ? 'bg-white text-black'
                          : 'text-silver hover:text-white hover:bg-dark-gray'
                      }`}
                      data-testid={`link-${link.label.toLowerCase()}`}
                    >
                      <Icon className="w-4 h-4" />
                      {link.label}
                    </a>
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 status-dot status-online" data-testid="status-dot" />
              <span className="text-sm text-silver">ONLINE</span>
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
          <Route path="/sessions" component={Sessions} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/pnl" component={PNL} />
          <Route path="/settings" component={Settings} />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
