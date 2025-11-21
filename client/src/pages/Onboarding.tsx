import { useState, useEffect } from 'react';
import { Check, Loader2, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusStep } from '@/components/ui/StatusStep';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useLocation } from 'wouter';
import { useStore } from '@/lib/store';
import { getDiag, runOAuth, createSSO } from '@/lib/api';
import { useQuery, useMutation } from '@tanstack/react-query';

export function Onboarding() {
  const [step, setStep] = useState(1);
  const [, setLocation] = useLocation();
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const {
    setGoogleConnected,
    setIBKRConnected,
    setLastDiag,
    aggression,
    setAggression,
    maxLeverage,
    setMaxLeverage,
    maxDailyLoss,
    setMaxDailyLoss,
    maxPerSymbol,
    setMaxPerSymbol,
  } = useStore();

  // Fetch IBKR status
  const { data: ibkrStatus, refetch: refetchIbkrStatus } = useQuery({
    queryKey: ['/api/ibkr/status'],
    queryFn: async () => {
      const response = await fetch('/api/ibkr/status');
      return response.json();
    },
    enabled: step === 2,
    refetchInterval: step === 2 ? 10000 : false, // Refresh every 10 seconds when on step 2
  });

  // Test connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/ibkr/test', { method: 'POST' });
      const data = await response.json();
      await refetchIbkrStatus();
      return data;
    },
  });

  // Fetch strategy configuration
  const { data: strategyConfig, refetch: refetchStrategyConfig } = useQuery({
    queryKey: ['/api/ibkr/strategy/status'],
    queryFn: async () => {
      // First initialize the strategy to get real NAV values
      const initResponse = await fetch('/api/ibkr/strategy/init', { method: 'POST' });
      const initData = await initResponse.json();
      if (!initData.success) {
        // If init fails, return default values
        return null;
      }
      // Then get the status
      const statusResponse = await fetch('/api/ibkr/strategy/status');
      const statusData = await statusResponse.json();
      return statusData.status;
    },
    enabled: step === 3 && isIBKRConnected,
    refetchInterval: false,
  });

  // Check for OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stepParam = params.get('step');
    const error = params.get('error');
    const errorDescription = params.get('error_description');

    console.log('[OAuth] Checking callback params:', { stepParam, error, errorDescription });

    if (error) {
      console.error('[OAuth] Authentication error:', error, errorDescription);
      setOauthError(errorDescription || error || 'Authentication failed. Please try again.');
      setOauthLoading(false);
      // Clean up URL but stay on step 1
      window.history.replaceState({}, '', '/onboarding');
    } else if (stepParam === '2') {
      console.log('[OAuth] Successfully authenticated with Google');
      // User successfully authenticated with Google
      setGoogleConnected(true);
      setOauthError(null);
      setOauthLoading(false);
      setStep(2);
      // Clean up URL
      window.history.replaceState({}, '', '/onboarding');
    } else if (stepParam === 'loading') {
      // OAuth is in progress
      console.log('[OAuth] Authentication in progress...');
      setOauthLoading(true);
      setOauthError(null);
    }
  }, [setGoogleConnected, setStep, setOauthError, setOauthLoading]);

  const handleGoogleLogin = () => {
    console.log('[OAuth] Starting Google login...');
    setOauthLoading(true);
    setOauthError(null);
    // Redirect to backend Google OAuth endpoint
    window.location.href = '/api/auth/google';
  };

  const handleIBKRConnect = async () => {
    // Test the IBKR connection
    const result = await testConnectionMutation.mutateAsync();
    if (result.success) {
      setIBKRConnected(true);
    }
  };

  const handleFinish = () => {
    // Navigate directly to agent to avoid redirect chain that causes black screen
    setLocation('/agent');
  };

  const isIBKRConnected = ibkrStatus?.connected || false;
  const isIBKRConfigured = ibkrStatus?.configured || false;

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="max-w-2xl w-full">
        {/* Stepper Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-center mb-8" data-testid="text-onboarding-title">
            Get Started with APEYOLO
          </h1>
          
          <div className="flex items-center justify-center gap-4">
            {[1, 2, 3].map((num) => (
              <div key={num} className="flex items-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-colors ${
                    step > num
                      ? 'bg-green-500 text-black'
                      : step === num
                      ? 'bg-white text-black'
                      : 'bg-mid-gray text-silver'
                  }`}
                  data-testid={`step-indicator-${num}`}
                >
                  {step > num ? <Check className="w-5 h-5" /> : num}
                </div>
                {num < 3 && (
                  <div
                    className={`w-16 h-1 mx-2 ${
                      step > num ? 'bg-green-500' : 'bg-mid-gray'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-center gap-4 mt-4 text-sm text-silver">
            <span className={step === 1 ? 'text-white font-medium' : ''}>Google Login</span>
            <span>•</span>
            <span className={step === 2 ? 'text-white font-medium' : ''}>Connect IBKR</span>
            <span>•</span>
            <span className={step === 3 ? 'text-white font-medium' : ''}>Risk Preferences</span>
          </div>
        </div>

        {/* Step Content */}
        <div className="bg-charcoal rounded-2xl p-8 border border-white/10 shadow-lg">
          {/* Step 1: Google Login */}
          {step === 1 && (
            <div className="space-y-6" data-testid="step-google-login">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-semibold mb-2">Sign In with Google</h2>
                <p className="text-silver">
                  We use Google for secure authentication. Your credentials are never stored.
                </p>
              </div>

              {/* OAuth Error Message */}
              {oauthError && (
                <div className="bg-red-900/20 rounded-lg p-4 border border-red-500/30">
                  <div className="flex items-start gap-3">
                    <XCircle className="w-5 h-5 text-red-500 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-red-400 mb-1">Authentication Failed</h4>
                      <p className="text-sm text-silver">{oauthError}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* OAuth Loading State */}
              {oauthLoading && (
                <div className="bg-blue-900/20 rounded-lg p-4 border border-blue-500/30">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                    <div>
                      <h4 className="font-medium text-blue-400">Authenticating with Google...</h4>
                      <p className="text-sm text-silver">Please complete the login in the popup window</p>
                    </div>
                  </div>
                </div>
              )}

              <Button
                onClick={handleGoogleLogin}
                className="btn-primary w-full text-lg py-6"
                disabled={oauthLoading}
                data-testid="button-google-login"
              >
                {oauthLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                    Authenticating...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                      <path
                        fill="currentColor"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="currentColor"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="currentColor"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    {oauthError ? 'Try Again' : 'Continue with Google'}
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Step 2: IBKR Connection */}
          {step === 2 && (
            <div className="space-y-6" data-testid="step-ibkr-connect">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-semibold mb-2">Interactive Brokers Connection</h2>
                <p className="text-silver">
                  Check your IBKR connection status and test the integration
                </p>
              </div>

              {/* Connection Status */}
              <div className={`p-4 rounded-lg border ${
                isIBKRConnected ? 'bg-green-900/20 border-green-500/30' :
                isIBKRConfigured ? 'bg-yellow-900/20 border-yellow-500/30' :
                'bg-red-900/20 border-red-500/30'
              }`}>
                <div className="flex items-center gap-3 mb-3">
                  {isIBKRConnected ? (
                    <CheckCircle className="w-6 h-6 text-green-500" />
                  ) : isIBKRConfigured ? (
                    <AlertCircle className="w-6 h-6 text-yellow-500" />
                  ) : (
                    <XCircle className="w-6 h-6 text-red-500" />
                  )}
                  <div>
                    <h3 className={`font-semibold ${
                      isIBKRConnected ? 'text-green-400' :
                      isIBKRConfigured ? 'text-yellow-400' :
                      'text-red-400'
                    }`}>
                      {isIBKRConnected ? 'Connected' :
                       isIBKRConfigured ? 'Configured but Not Connected' :
                       'Not Configured'}
                    </h3>
                    <p className="text-sm text-silver">
                      {isIBKRConnected ? 'Your IBKR account is connected and ready to trade' :
                       isIBKRConfigured ? 'IBKR credentials are configured. Click Test Connection to verify.' :
                       'IBKR credentials need to be configured in environment variables'}
                    </p>
                  </div>
                </div>

                {/* Connection Details */}
                {ibkrStatus && (
                  <div className="mt-3 pt-3 border-t border-white/10 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-silver">Environment:</span>
                      <span className="font-mono">{ibkrStatus.environment}</span>
                    </div>
                    {ibkrStatus.accountId && (
                      <div className="flex justify-between">
                        <span className="text-silver">Account ID:</span>
                        <span className="font-mono">{ibkrStatus.accountId}</span>
                      </div>
                    )}
                    {ibkrStatus.diagnostics && (
                      <div className="mt-3">
                        <span className="text-silver text-sm">Authentication Pipeline:</span>
                        <div className="mt-2 space-y-2">
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
                            name="Validation"
                            status={ibkrStatus.diagnostics.validate?.status || ibkrStatus.diagnostics.validated?.status || 0}
                            message={ibkrStatus.diagnostics.validate?.message || ibkrStatus.diagnostics.validated?.message || ibkrStatus.diagnostics.validated || 'Not attempted'}
                            success={ibkrStatus.diagnostics.validate?.success || ibkrStatus.diagnostics.validated?.success}
                          />
                          <StatusStep
                            name="Initialization"
                            status={ibkrStatus.diagnostics.init?.status || ibkrStatus.diagnostics.initialized?.status || 0}
                            message={ibkrStatus.diagnostics.init?.message || ibkrStatus.diagnostics.initialized?.message || ibkrStatus.diagnostics.initialized || 'Not attempted'}
                            success={ibkrStatus.diagnostics.init?.success || ibkrStatus.diagnostics.initialized?.success}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {!isIBKRConnected ? (
                <>
                  {!isIBKRConfigured && (
                    <div className="bg-dark-gray rounded-lg p-4 border border-white/10">
                      <h3 className="font-medium mb-3">Setup Required:</h3>
                      <p className="text-sm text-silver mb-3">
                        IBKR OAuth credentials must be configured on the server. Please ensure the following environment variables are set:
                      </p>
                      <ul className="text-sm text-silver space-y-1 font-mono">
                        <li>• IBKR_CLIENT_ID</li>
                        <li>• IBKR_CLIENT_KEY_ID</li>
                        <li>• IBKR_PRIVATE_KEY</li>
                        <li>• IBKR_CREDENTIAL</li>
                        <li>• IBKR_ACCOUNT_ID</li>
                      </ul>
                    </div>
                  )}

                  {isIBKRConfigured && (
                    <>
                    <Button
                      onClick={handleIBKRConnect}
                      className="btn-primary w-full text-lg py-6"
                      disabled={testConnectionMutation.isPending}
                      data-testid="button-test-connection"
                    >
                      {testConnectionMutation.isPending ? (
                        <>
                          <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                        Testing Connection...
                      </>
                    ) : (
                      'Test Connection'
                    )}
                  </Button>

                  <Button
                    onClick={() => setStep(3)}
                    className="btn-secondary w-full text-lg py-6 mt-3"
                    data-testid="button-skip-ibkr"
                  >
                    Skip for Now
                  </Button>
                  </>
                  )}
                </>
              ) : (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                    <Check className="w-8 h-8 text-green-500" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">Successfully Connected!</h3>
                  <p className="text-silver mb-6">
                    Your IBKR account is now linked and ready to trade in {ibkrStatus?.environment || 'paper'} mode.
                  </p>
                  <Button
                    onClick={() => setStep(3)}
                    className="btn-primary"
                    data-testid="button-next-to-risk"
                  >
                    Continue to Risk Preferences
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Strategy Configuration */}
          {step === 3 && (
            <div className="space-y-6" data-testid="step-risk-preferences">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-semibold mb-2">Naked Option Strategy Configuration</h2>
                <p className="text-silver">
                  Review your 0DTE naked option selling parameters
                </p>
              </div>

              <div className="bg-dark-gray rounded-lg p-6 border border-white/10 space-y-4">
                <h3 className="font-medium text-lg mb-3">Account & Position Sizing</h3>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-silver text-sm">Net Asset Value (NAV)</Label>
                    <div className="text-2xl font-mono mt-1">
                      {strategyConfig?.config?.capital
                        ? `${(strategyConfig.config.capital).toLocaleString()} HKD`
                        : '~1,000,000 HKD'}
                    </div>
                    <p className="text-xs text-silver mt-1">Paper trading account</p>
                  </div>
                  <div>
                    <Label className="text-silver text-sm">Buying Power</Label>
                    <div className="text-2xl font-mono mt-1">
                      {strategyConfig?.config?.buyingPower
                        ? `${(strategyConfig.config.buyingPower).toLocaleString()} HKD`
                        : '~6,660,000 HKD'}
                    </div>
                    <p className="text-xs text-silver mt-1">NAV × 6.66 margin</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div>
                    <Label className="text-silver text-sm">Max Contracts per Side</Label>
                    <div className="text-2xl font-mono mt-1">
                      {strategyConfig?.config?.maxContractsPerSide
                        ? `${strategyConfig.config.maxContractsPerSide} contracts`
                        : '~30 contracts'}
                    </div>
                    <p className="text-xs text-silver mt-1">PUT or CALL options</p>
                  </div>
                  <div>
                    <Label className="text-silver text-sm">Options Margin Multiplier</Label>
                    <div className="text-2xl font-mono mt-1">
                      {strategyConfig?.config?.optionsMarginMultiplier || 2}x
                    </div>
                    <p className="text-xs text-silver mt-1">vs shares margin</p>
                  </div>
                </div>
              </div>

              <div className="bg-dark-gray rounded-lg p-6 border border-white/10 space-y-4">
                <h3 className="font-medium text-lg mb-3">Trading Parameters</h3>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-silver text-sm">Max Delta</Label>
                    <div className="text-xl font-mono mt-1">
                      {strategyConfig?.config?.maxDelta || 0.30}
                    </div>
                    <p className="text-xs text-silver mt-1">Option selection filter</p>
                  </div>
                  <div>
                    <Label className="text-silver text-sm">Days to Expiration</Label>
                    <div className="text-xl font-mono mt-1">0DTE</div>
                    <p className="text-xs text-silver mt-1">Same-day expiry</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div>
                    <Label className="text-silver text-sm">Stop Loss</Label>
                    <div className="text-xl font-mono mt-1">200%</div>
                    <p className="text-xs text-silver mt-1">of premium collected</p>
                  </div>
                  <div>
                    <Label className="text-silver text-sm">Trading Hours</Label>
                    <div className="text-xl font-mono mt-1">12:00 - 14:00</div>
                    <p className="text-xs text-silver mt-1">Hong Kong time</p>
                  </div>
                </div>
              </div>

              <div className="bg-yellow-900/20 rounded-lg p-4 border border-yellow-500/30">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-yellow-400 mb-1">Paper Trading Mode</h4>
                    <p className="text-sm text-silver">
                      This strategy is configured for paper trading with IBKR.
                      Position sizes are calculated based on your actual paper trading NAV.
                      The strategy will dynamically adjust as your account value changes.
                    </p>
                  </div>
                </div>
              </div>

              <Button
                onClick={async () => {
                  // Initialize the strategy when finishing onboarding
                  try {
                    const response = await fetch('/api/ibkr/strategy/init', { method: 'POST' });
                    const data = await response.json();
                    if (data.success) {
                      console.log('Strategy initialized:', data.config);
                    }
                  } catch (error) {
                    console.error('Failed to initialize strategy:', error);
                  }
                  handleFinish();
                }}
                className="btn-primary w-full text-lg py-6"
                data-testid="button-finish-onboarding"
              >
                Initialize Strategy & Go to Dashboard
              </Button>
            </div>
          )}
        </div>

        {/* Navigation Buttons */}
        {step > 1 && step < 3 && (
          <div className="mt-6 flex justify-between">
            <Button
              onClick={() => setStep(step - 1)}
              className="btn-secondary"
              data-testid="button-back"
            >
              Back
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
