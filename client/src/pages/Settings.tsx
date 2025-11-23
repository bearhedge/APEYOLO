import { useState, useEffect } from 'react';
import { RefreshCw, Bell, Shield, Bot, Settings as SettingsIcon, CheckCircle, XCircle, AlertCircle, Trash2 } from 'lucide-react';
import { SectionHeader } from '@/components/SectionHeader';
import { Button } from '@/components/ui/button';
import { StatusStep } from '@/components/ui/StatusStep';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { BrokerStatus, RiskCfg } from '@shared/types';

export function Settings() {
  const [aggression, setAggression] = useState(50);
  const [maxLeverage, setMaxLeverage] = useState(2);
  const [perTradeRisk, setPerTradeRisk] = useState(2);
  const [dailyLoss, setDailyLoss] = useState(5);
  const [maxPositions, setMaxPositions] = useState(10);
  const [maxNotional, setMaxNotional] = useState(100000);
  const [autoRoll, setAutoRoll] = useState(false);
  const [autoHedge, setAutoHedge] = useState(false);
  const [marketHoursOnly, setMarketHoursOnly] = useState(true);
  const [circuitBreaker, setCircuitBreaker] = useState(true);
  const [testResult, setTestResult] = useState<any>(null);
  const [orderResult, setOrderResult] = useState<any>(null);
  const [clearResult, setClearResult] = useState<any>(null);

  // Fetch IBKR status with adaptive polling
  const { data: ibkrStatus, refetch: refetchStatus } = useQuery({
    queryKey: ['/api/ibkr/status'],
    queryFn: async () => {
      const response = await fetch('/api/ibkr/status');
      return response.json();
    },
    refetchInterval: (data) => {
      // Adaptive polling based on connection state
      if (!data?.configured) return false; // Don't poll if not configured
      if (data?.configured && !data?.connected) return 3000; // 3s when connecting
      return 30000; // 30s when stable
    },
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Test connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/ibkr/test', { method: 'POST' });
      const data = await response.json();
      setTestResult(data);
      return data;
    },
    onSuccess: () => {
      // Trigger immediate refetch after test
      refetchStatus();
    },
  });

  const reconnectMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/broker/oauth', { method: 'POST' });
      return response.json();
    },
    onSuccess: () => {
      // Trigger immediate refetch after reconnect
      refetchStatus();
    },
  });

  // Warm endpoint (runs full readiness flow server-side)
  const warmMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/broker/warm');
      return response.json();
    },
    onSuccess: () => refetchStatus(),
  });

  // Hybrid auto-reconnect: auto warm/reconnect with gentle backoff; manual button remains
  const [lastAttemptAt, setLastAttemptAt] = useState<number>(0);
  const [backoffMs, setBackoffMs] = useState<number>(5000);

  useEffect(() => {
    const now = Date.now();
    if (!ibkrStatus?.configured) return;
    if (ibkrStatus?.connected) {
      // reset backoff on success
      if (backoffMs !== 5000) setBackoffMs(5000);
      return;
    }
    // avoid thrash while disconnected
    if (now - lastAttemptAt < backoffMs) return;
    setLastAttemptAt(now);
    // try warm first; if not ok, fall back to reconnect
    warmMutation.mutate(undefined, {
      onSuccess: (d: any) => {
        if (!d?.ok) {
          reconnectMutation.mutate(undefined, {
            onSettled: () => {
              setBackoffMs((ms) => Math.min(60000, ms * 2));
              refetchStatus();
            },
          });
        } else {
          refetchStatus();
        }
      },
      onError: () => {
        reconnectMutation.mutate(undefined, {
          onSettled: () => {
            setBackoffMs((ms) => Math.min(60000, ms * 2));
            refetchStatus();
          },
        });
      },
    });
  }, [ibkrStatus?.configured, ibkrStatus?.connected, lastAttemptAt, backoffMs]);

  // Test order mutation
  const testOrderMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/broker/paper/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: 'SPY',
          side: 'BUY',
          quantity: 1,
          orderType: 'MKT',
          tif: 'DAY',
        }),
      });
      const data = await response.json();
      setOrderResult(data);
      return data;
    },
  });

  // Clear all open orders mutation
  const clearOrdersMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/ibkr/clear-orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json();
      setClearResult(data);
      return data;
    },
  });

  const getConnectionIcon = () => {
    if (!ibkrStatus?.configured) return <AlertCircle className="w-5 h-5 text-yellow-500" />;
    if (ibkrStatus?.connected) return <CheckCircle className="w-5 h-5 text-green-500" />;
    return <XCircle className="w-5 h-5 text-red-500" />;
  };

  const getConnectionStatus = () => {
    if (!ibkrStatus?.configured) return 'Not Configured';
    if (ibkrStatus?.connected) return 'Connected';
    return 'Disconnected';
  };

  return (
    <div className="p-6 space-y-6">
      <SectionHeader
        title="Settings"
        subtitle="Configure broker connection, risk parameters, and automation"
        testId="header-settings"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Broker Connection */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <SettingsIcon className="w-5 h-5" />
              <h3 className="text-lg font-semibold">IBKR Connection</h3>
            </div>
            <div className="flex items-center gap-2">
              {getConnectionIcon()}
              <span className={`text-sm font-medium ${
                ibkrStatus?.connected ? 'text-green-500' :
                ibkrStatus?.configured ? 'text-red-500' : 'text-yellow-500'
              }`}>
                {getConnectionStatus()}
              </span>
            </div>
          </div>

          <div className="space-y-4">
            {/* Connection Info */}
            <div className="p-4 bg-dark-gray rounded-lg border border-white/10">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-silver">Environment:</span>
                  <span className="text-sm font-mono">{ibkrStatus?.environment || 'paper'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-silver">Account ID:</span>
                  <span className="text-sm font-mono">{ibkrStatus?.accountId || 'Not configured'}</span>
                </div>
                {ibkrStatus?.clientId && (
                  <div className="flex justify-between">
                    <span className="text-sm text-silver">Client ID:</span>
                    <span className="text-sm font-mono">{ibkrStatus.clientId}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-sm text-silver">Multi-User Mode:</span>
                  <span className="text-sm">{ibkrStatus?.multiUserMode ? 'Enabled' : 'Disabled'}</span>
                </div>
              </div>
            </div>

            {/* Connection Status Details */}
            {ibkrStatus?.configured && ibkrStatus.diagnostics && (
              <div className="border-t border-white/10 pt-4">
                <h4 className="text-sm font-medium mb-3">Authentication Pipeline Status</h4>
                <div className="space-y-2">
                  <StatusStep
                    name="OAuth Token"
                    status={ibkrStatus.diagnostics.oauth?.status || 0}
                    message={ibkrStatus.diagnostics.oauth?.message || ibkrStatus.diagnostics.oauth || 'Not attempted'}
                    success={ibkrStatus.diagnostics.oauth?.success}
                  />
                  <StatusStep
                    name="SSO Session"
                    status={ibkrStatus.diagnostics.sso?.status || 0}
                    message={ibkrStatus.diagnostics.sso?.message || ibkrStatus.diagnostics.sso || 'Not attempted'}
                    success={ibkrStatus.diagnostics.sso?.success}
                  />
                  <StatusStep
                    name="Session Validation"
                    status={ibkrStatus.diagnostics.validate?.status || ibkrStatus.diagnostics.validated?.status || 0}
                    message={ibkrStatus.diagnostics.validate?.message || ibkrStatus.diagnostics.validated?.message || ibkrStatus.diagnostics.validated || 'Not attempted'}
                    success={ibkrStatus.diagnostics.validate?.success || ibkrStatus.diagnostics.validated?.success}
                  />
                  <StatusStep
                    name="Brokerage Initialization"
                    status={ibkrStatus.diagnostics.init?.status || ibkrStatus.diagnostics.initialized?.status || 0}
                    message={ibkrStatus.diagnostics.init?.message || ibkrStatus.diagnostics.initialized?.message || ibkrStatus.diagnostics.initialized || 'Not attempted'}
                    success={ibkrStatus.diagnostics.init?.success || ibkrStatus.diagnostics.initialized?.success}
                  />
                </div>
              </div>
            )}

            {/* Test Result */}
            {testResult && (
              <div className={`p-3 rounded-lg border ${
                testResult.success ? 'bg-green-900/20 border-green-500/30' : 'bg-red-900/20 border-red-500/30'
              }`}>
                <p className={`text-sm font-medium mb-2 ${
                  testResult.success ? 'text-green-400' : 'text-red-400'
                }`}>
                  Connection Test: {testResult.message}
                </p>
                {testResult.steps && (
                  <div className="space-y-1">
                    {Object.entries(testResult.steps).map(([key, step]: [string, any]) => (
                      <div key={key} className="flex items-center gap-2 text-xs">
                        {step.success ? (
                          <CheckCircle className="w-3 h-3 text-green-500" />
                        ) : (
                          <XCircle className="w-3 h-3 text-red-500" />
                        )}
                        <span className="text-silver">{step.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Order Result */}
            {orderResult && (
              <div className={`p-3 rounded-lg border ${
                orderResult.success ? 'bg-green-900/20 border-green-500/30' : 'bg-red-900/20 border-red-500/30'
              }`}>
                <p className={`text-sm font-medium mb-2 ${
                  orderResult.success ? 'text-green-400' : 'text-red-400'
                }`}>
                  Test Order: {orderResult.message || (orderResult.success ? 'Order Submitted' : 'Order Failed')}
                </p>
                {orderResult.orderId && (
                  <p className="text-xs text-silver">Order ID: {orderResult.orderId}</p>
                )}
                {orderResult.error && (
                  <p className="text-xs text-red-400 mt-1">{orderResult.error}</p>
                )}
              </div>
            )}

            {/* Clear Orders Result */}
            {clearResult && (
              <div className={`p-3 rounded-lg border ${
                clearResult.success ? 'bg-green-900/20 border-green-500/30' : 'bg-red-900/20 border-red-500/30'
              }`}>
                <p className={`text-sm font-medium mb-2 ${
                  clearResult.success ? 'text-green-400' : 'text-red-400'
                }`}>
                  {clearResult.message || 'Clear Orders Result'}
                </p>
                {clearResult.cleared > 0 && (
                  <p className="text-xs text-silver">Cleared {clearResult.cleared} order(s)</p>
                )}
                {clearResult.errors && clearResult.errors.length > 0 && (
                  <div className="text-xs text-red-400 mt-1">
                    {clearResult.errors.map((err: any, i: number) => (
                      <p key={i}>{err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="border-t border-white/10 pt-4 space-y-2">
              {!ibkrStatus?.configured && (
                <div className="p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-lg">
                  <p className="text-sm text-yellow-400">
                    IBKR credentials not configured. Please set up your IBKR OAuth credentials in the environment variables.
                  </p>
                </div>
              )}

              <Button
                onClick={() => testConnectionMutation.mutate()}
                className="btn-primary w-full"
                disabled={testConnectionMutation.isPending || !ibkrStatus?.configured}
                data-testid="button-test-connection"
              >
                {testConnectionMutation.isPending ? 'Testing Connection...' : 'Test Connection'}
              </Button>

              {ibkrStatus?.connected && (
                <>
                  <Button
                    onClick={() => testOrderMutation.mutate()}
                    className="btn-secondary w-full"
                    disabled={testOrderMutation.isPending}
                    data-testid="button-test-order"
                  >
                    {testOrderMutation.isPending ? 'Placing Test Order...' : 'Test Order (Buy 1 SPY)'}
                  </Button>

                  <Button
                    onClick={() => clearOrdersMutation.mutate()}
                    className="btn-secondary w-full flex items-center justify-center gap-2"
                    disabled={clearOrdersMutation.isPending}
                    data-testid="button-clear-orders"
                  >
                    <Trash2 className="w-4 h-4" />
                    {clearOrdersMutation.isPending ? 'Clearing Orders...' : 'Clear All Open Orders'}
                  </Button>
                </>
              )}

              {ibkrStatus?.configured && !ibkrStatus?.connected && (
                <Button
                  onClick={() => reconnectMutation.mutate()}
                  className="btn-secondary w-full"
                  disabled={reconnectMutation.isPending}
                  data-testid="button-reconnect"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {reconnectMutation.isPending ? 'Reconnecting...' : 'Reconnect'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Risk & Automation */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="w-5 h-5" />
            <h3 className="text-lg font-semibold">Risk & Automation (95% Automated)</h3>
          </div>

          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Aggression</Label>
                <span className="text-sm tabular-nums">{aggression}%</span>
              </div>
              <Slider
                value={[aggression]}
                onValueChange={(val) => setAggression(val[0])}
                min={0}
                max={100}
                step={1}
                className="mb-1"
                data-testid="slider-aggression"
              />
              <div className="flex justify-between text-xs text-silver">
                <span>Conservative</span>
                <span>Aggressive</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="max-leverage">Max Leverage</Label>
                <Input
                  id="max-leverage"
                  type="number"
                  value={maxLeverage}
                  onChange={(e) => setMaxLeverage(Number(e.target.value))}
                  className="input-monochrome mt-1"
                  data-testid="input-max-leverage"
                />
              </div>
              <div>
                <Label htmlFor="per-trade-risk">Per-Trade Risk %</Label>
                <Input
                  id="per-trade-risk"
                  type="number"
                  value={perTradeRisk}
                  onChange={(e) => setPerTradeRisk(Number(e.target.value))}
                  className="input-monochrome mt-1"
                  data-testid="input-per-trade-risk"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="daily-loss">Daily Loss Limit %</Label>
                <Input
                  id="daily-loss"
                  type="number"
                  value={dailyLoss}
                  onChange={(e) => setDailyLoss(Number(e.target.value))}
                  className="input-monochrome mt-1"
                  data-testid="input-daily-loss"
                />
              </div>
              <div>
                <Label htmlFor="max-positions">Max Open Positions</Label>
                <Input
                  id="max-positions"
                  type="number"
                  value={maxPositions}
                  onChange={(e) => setMaxPositions(Number(e.target.value))}
                  className="input-monochrome mt-1"
                  data-testid="input-max-positions"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="max-notional">Max Notional Exposure</Label>
              <Input
                id="max-notional"
                type="number"
                value={maxNotional}
                onChange={(e) => setMaxNotional(Number(e.target.value))}
                className="input-monochrome mt-1"
                data-testid="input-max-notional"
              />
            </div>

            <div className="space-y-3 border-t border-white/10 pt-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="auto-roll">Auto-roll positions</Label>
                <Switch
                  id="auto-roll"
                  checked={autoRoll}
                  onCheckedChange={setAutoRoll}
                  data-testid="switch-auto-roll"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="auto-hedge">Auto-hedge</Label>
                <Switch
                  id="auto-hedge"
                  checked={autoHedge}
                  onCheckedChange={setAutoHedge}
                  data-testid="switch-auto-hedge"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="market-hours">Market hours only</Label>
                <Switch
                  id="market-hours"
                  checked={marketHoursOnly}
                  onCheckedChange={setMarketHoursOnly}
                  data-testid="switch-market-hours"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="circuit-breaker">Circuit breaker</Label>
                <Switch
                  id="circuit-breaker"
                  checked={circuitBreaker}
                  onCheckedChange={setCircuitBreaker}
                  data-testid="switch-circuit-breaker"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Agent Configuration */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <div className="flex items-center gap-3 mb-6">
            <Bot className="w-5 h-5" />
            <h3 className="text-lg font-semibold">Agent (OpenAI SDK)</h3>
          </div>

          <div className="space-y-4">
            <div>
              <Label htmlFor="model">Model</Label>
              <Select defaultValue="gpt-4">
                <SelectTrigger className="input-monochrome mt-1" data-testid="select-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-charcoal border-white/10">
                  <SelectItem value="gpt-4">GPT-4</SelectItem>
                  <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                  <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="api-key">API Key</Label>
              <Input
                id="api-key"
                type="password"
                placeholder="sk-••••••••••••••••"
                className="input-monochrome mt-1"
                data-testid="input-api-key"
              />
            </div>

            <div>
              <Label htmlFor="system-prompt">System Prompt</Label>
              <Textarea
                id="system-prompt"
                placeholder="You are an expert options trader..."
                className="input-monochrome mt-1 min-h-24"
                data-testid="textarea-system-prompt"
              />
            </div>

            <div>
              <Label htmlFor="strategy-preset">Strategy Preset</Label>
              <Select defaultValue="wheel">
                <SelectTrigger className="input-monochrome mt-1" data-testid="select-strategy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-charcoal border-white/10">
                  <SelectItem value="wheel">Wheel Strategy</SelectItem>
                  <SelectItem value="covered-calls">Covered Calls</SelectItem>
                  <SelectItem value="cash-secured-puts">Cash-Secured Puts</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="border-t border-white/10 pt-4">
              <h4 className="text-sm font-medium mb-3">Safety Rails</h4>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="ban-list">Symbol Ban List</Label>
                  <Input
                    id="ban-list"
                    placeholder="TSLA, GME, AMC"
                    className="input-monochrome mt-1"
                    data-testid="input-ban-list"
                  />
                </div>
                <div>
                  <Label htmlFor="min-liquidity">Min Liquidity (ADV / OI)</Label>
                  <Input
                    id="min-liquidity"
                    type="number"
                    placeholder="100000"
                    className="input-monochrome mt-1"
                    data-testid="input-min-liquidity"
                  />
                </div>
                <div>
                  <Label htmlFor="min-premium">Min Option Premium</Label>
                  <Input
                    id="min-premium"
                    type="number"
                    placeholder="0.50"
                    step="0.01"
                    className="input-monochrome mt-1"
                    data-testid="input-min-premium"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Notifications & Webhooks */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <div className="flex items-center gap-3 mb-6">
            <Bell className="w-5 h-5" />
            <h3 className="text-lg font-semibold">Notifications & Webhooks</h3>
          </div>

          <div className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="trader@example.com"
                className="input-monochrome mt-1"
                data-testid="input-email"
              />
            </div>

            <div>
              <Label htmlFor="slack">Slack Webhook</Label>
              <Input
                id="slack"
                placeholder="https://hooks.slack.com/services/..."
                className="input-monochrome mt-1"
                data-testid="input-slack"
              />
            </div>

            <div>
              <Label htmlFor="webhook">Custom Webhook</Label>
              <Input
                id="webhook"
                placeholder="https://api.example.com/webhook"
                className="input-monochrome mt-1"
                data-testid="input-webhook"
              />
            </div>

            <div className="border-t border-white/10 pt-4">
              <h4 className="text-sm font-medium mb-3">Notification Triggers</h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="notify-fills">Trade Fills</Label>
                  <Switch id="notify-fills" defaultChecked data-testid="switch-notify-fills" />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="notify-errors">Errors</Label>
                  <Switch id="notify-errors" defaultChecked data-testid="switch-notify-errors" />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="notify-risk">Risk Breaches</Label>
                  <Switch id="notify-risk" defaultChecked data-testid="switch-notify-risk" />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="notify-summary">Daily Summary</Label>
                  <Switch id="notify-summary" data-testid="switch-notify-summary" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* General Settings */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg lg:col-span-2">
          <div className="flex items-center gap-3 mb-6">
            <SettingsIcon className="w-5 h-5" />
            <h3 className="text-lg font-semibold">General</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="currency">Base Currency</Label>
              <Select defaultValue="usd">
                <SelectTrigger className="input-monochrome mt-1" data-testid="select-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-charcoal border-white/10">
                  <SelectItem value="usd">USD</SelectItem>
                  <SelectItem value="eur">EUR</SelectItem>
                  <SelectItem value="gbp">GBP</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="timezone">Timezone</Label>
              <Select defaultValue="america/new_york">
                <SelectTrigger className="input-monochrome mt-1" data-testid="select-timezone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-charcoal border-white/10">
                  <SelectItem value="america/new_york">America/New York</SelectItem>
                  <SelectItem value="america/chicago">America/Chicago</SelectItem>
                  <SelectItem value="america/los_angeles">America/Los Angeles</SelectItem>
                  <SelectItem value="europe/london">Europe/London</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="number-format">Number Format</Label>
              <Select defaultValue="us">
                <SelectTrigger className="input-monochrome mt-1" data-testid="select-number-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-charcoal border-white/10">
                  <SelectItem value="us">US (1,234.56)</SelectItem>
                  <SelectItem value="eu">EU (1.234,56)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-6 p-4 bg-dark-gray rounded-lg border border-white/10">
            <p className="text-sm text-silver">
              Theme: Monochrome only. All visual customization is managed through the application design system.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <Button className="btn-secondary" data-testid="button-reset">
          Reset to Defaults
        </Button>
        <Button className="btn-primary" data-testid="button-save-settings">
          Save Settings
        </Button>
      </div>
    </div>
  );
}
