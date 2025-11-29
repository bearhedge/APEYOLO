import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, LogOut } from "lucide-react";
import type { AccountInfo } from "@/lib/types";

export default function AppHeader() {
  const queryClient = useQueryClient();

  const { data: account } = useQuery<AccountInfo>({
    queryKey: ['/api/account'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

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
