import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Redirect } from "wouter";
import { Wallet } from "lucide-react";
import { Home } from "@/pages/Home";
import { Onboarding } from "@/pages/Onboarding";
import { Portfolio } from "@/pages/Portfolio";
import { TrackRecord } from "@/pages/TrackRecord";
import { DD } from "@/pages/DD";
import { Jobs } from "@/pages/Jobs";
import { Settings } from "@/pages/Settings";
import { Terminal } from "@/pages/Terminal";
import { WalletProvider, useWalletContext } from "@/components/WalletProvider";
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <TooltipProvider>
          <Toaster />
          <div className="min-h-screen bg-background text-foreground">
            <Route path="/" component={Home} />
            <Route path="/onboarding" component={Onboarding} />

            {/* Main route */}
            <Route path="/terminal" component={Terminal} />

            {/* Legacy redirects - all go to terminal */}
            <Route path="/trade">
              <Redirect to="/terminal" />
            </Route>
            <Route path="/admin">
              <Redirect to="/terminal" />
            </Route>
            <Route path="/review">
              <Redirect to="/terminal" />
            </Route>
            <Route path="/defi">
              <Redirect to="/terminal" />
            </Route>
            <Route path="/engine">
              <Redirect to="/terminal" />
            </Route>
            <Route path="/portfolio" component={Portfolio} />
            <Route path="/track-record" component={TrackRecord} />
            <Route path="/jobs" component={Jobs} />
            <Route path="/settings" component={Settings} />

            {/* Other routes */}
            <Route path="/dd" component={DD} />

            {/* More legacy redirects */}
            <Route path="/dashboard">
              <Redirect to="/terminal" />
            </Route>
            <Route path="/sessions">
              <Redirect to="/terminal" />
            </Route>
            <Route path="/trades">
              <Redirect to="/terminal" />
            </Route>
          </div>
        </TooltipProvider>
      </WalletProvider>
    </QueryClientProvider>
  );
}

export default App;
