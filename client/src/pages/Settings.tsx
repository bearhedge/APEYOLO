import { useState } from 'react';
import { RefreshCw, Bell, Shield, Bot, Settings as SettingsIcon } from 'lucide-react';
import { SectionHeader } from '@/components/SectionHeader';
import { Button } from '@/components/ui/button';
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

  const { data: brokerStatus } = useQuery<BrokerStatus>({
    queryKey: ['/api/broker/diag'],
  });

  const reconnectMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/broker/oauth', { method: 'POST' });
      return response.json();
    },
  });

  const getStatusBadge = (code: number | null) => {
    if (!code) return <span className="badge-monochrome badge-error">NOT CONNECTED</span>;
    if (code === 200) return <span className="badge-monochrome badge-success">CONNECTED</span>;
    return <span className="badge-monochrome badge-warning">ERROR {code}</span>;
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
          <div className="flex items-center gap-3 mb-6">
            <SettingsIcon className="w-5 h-5" />
            <h3 className="text-lg font-semibold">Broker Connection (IBKR OAuth2)</h3>
          </div>
          
          <div className="space-y-4">
            <div>
              <Label className="text-silver">Client ID</Label>
              <Input
                value="IBKR-12345678"
                readOnly
                className="input-monochrome mt-1 bg-mid-gray cursor-not-allowed"
                data-testid="input-client-id"
              />
            </div>
            
            <div>
              <Label className="text-silver">Key ID</Label>
              <Input
                value="••••••••••••1234"
                readOnly
                className="input-monochrome mt-1 bg-mid-gray cursor-not-allowed"
                data-testid="input-key-id"
              />
            </div>
            
            <div>
              <Label className="text-silver">Account</Label>
              <Input
                value="U••••••89"
                readOnly
                className="input-monochrome mt-1 bg-mid-gray cursor-not-allowed"
                data-testid="input-account"
              />
            </div>

            <div className="border-t border-white/10 pt-4">
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div>
                  <p className="text-xs text-silver mb-1">OAuth 2.0</p>
                  {getStatusBadge(brokerStatus?.oauth || null)}
                </div>
                <div>
                  <p className="text-xs text-silver mb-1">SSO</p>
                  {getStatusBadge(brokerStatus?.sso || null)}
                </div>
                <div>
                  <p className="text-xs text-silver mb-1">Session</p>
                  {getStatusBadge(brokerStatus?.init || null)}
                </div>
              </div>

              {brokerStatus?.traceId && (
                <p className="text-xs text-silver mb-4" data-testid="text-trace-id">
                  Trace ID: {brokerStatus.traceId}
                </p>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Button className="btn-secondary text-sm" data-testid="button-request-oauth">
                  Request OAuth Token
                </Button>
                <Button className="btn-secondary text-sm" data-testid="button-create-sso">
                  Create SSO Session
                </Button>
                <Button className="btn-secondary text-sm" data-testid="button-validate-sso">
                  Validate SSO
                </Button>
                <Button className="btn-secondary text-sm" data-testid="button-init-session">
                  Init Brokerage Session
                </Button>
                <Button className="btn-secondary text-sm" data-testid="button-tickle">
                  Tickle
                </Button>
                <Button className="btn-secondary text-sm" data-testid="button-logout">
                  Logout
                </Button>
              </div>

              <Button
                onClick={() => reconnectMutation.mutate()}
                className="btn-primary w-full mt-4"
                disabled={reconnectMutation.isPending}
                data-testid="button-reconnect"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                {reconnectMutation.isPending ? 'Reconnecting...' : 'Reconnect'}
              </Button>
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
