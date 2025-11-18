import { useState, useEffect } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

  const { data: diagData, refetch: refetchDiag } = useQuery({
    queryKey: ['/api/broker/diag'],
    queryFn: getDiag,
    enabled: step === 2,
  });

  const oauthMutation = useMutation({
    mutationFn: async () => {
      const oauthResult = await runOAuth();
      const ssoResult = await createSSO();
      await refetchDiag();
      return { oauth: oauthResult, sso: ssoResult };
    },
  });

  // Check for OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stepParam = params.get('step');
    const error = params.get('error');

    if (error) {
      console.error('OAuth error:', error);
      // Could show an error message to the user here
    } else if (stepParam === '2') {
      // User successfully authenticated with Google
      setGoogleConnected(true);
      setStep(2);
      // Clean up URL
      window.history.replaceState({}, '', '/onboarding');
    }
  }, [setGoogleConnected]);

  const handleGoogleLogin = () => {
    // Redirect to backend Google OAuth endpoint
    window.location.href = '/api/auth/google';
  };

  const handleIBKRConnect = async () => {
    await oauthMutation.mutateAsync();
  };

  const handleFinish = () => {
    setLocation('/dashboard');
  };

  const isIBKRConnected = diagData?.oauth === 200 && diagData?.sso === 200;

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

              <Button
                onClick={handleGoogleLogin}
                className="btn-primary w-full text-lg py-6"
                data-testid="button-google-login"
              >
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
                Continue with Google
              </Button>
            </div>
          )}

          {/* Step 2: IBKR Connection */}
          {step === 2 && (
            <div className="space-y-6" data-testid="step-ibkr-connect">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-semibold mb-2">Connect Interactive Brokers</h2>
                <p className="text-silver">
                  We'll establish a secure OAuth2 connection to your IBKR account
                </p>
              </div>

              {!isIBKRConnected ? (
                <>
                  <div className="bg-dark-gray rounded-lg p-4 border border-white/10">
                    <h3 className="font-medium mb-3">Connection Requirements:</h3>
                    <ul className="text-sm text-silver space-y-2">
                      <li className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-silver" />
                        Active IBKR account with API access enabled
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-silver" />
                        OAuth2 credentials configured in Client Portal
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-silver" />
                        Two-factor authentication enabled
                      </li>
                    </ul>
                  </div>

                  <Button
                    onClick={handleIBKRConnect}
                    className="btn-primary w-full text-lg py-6"
                    disabled={oauthMutation.isPending}
                    data-testid="button-connect-ibkr"
                  >
                    {oauthMutation.isPending ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                        Connecting to IBKR...
                      </>
                    ) : (
                      'Connect IBKR Account'
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
              ) : (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                    <Check className="w-8 h-8 text-green-500" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">Successfully Connected!</h3>
                  <p className="text-silver mb-6">
                    Your IBKR account is now linked. OAuth: ✅ SSO: ✅
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

          {/* Step 3: Risk Preferences */}
          {step === 3 && (
            <div className="space-y-6" data-testid="step-risk-preferences">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-semibold mb-2">Set Your Risk Preferences</h2>
                <p className="text-silver">
                  Configure your trading limits and risk parameters
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Aggression Level</Label>
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
                  <Label htmlFor="leverage-cap">Leverage Cap</Label>
                  <Input
                    id="leverage-cap"
                    type="number"
                    value={maxLeverage}
                    onChange={(e) => setMaxLeverage(Number(e.target.value))}
                    className="input-monochrome mt-1"
                    data-testid="input-leverage-cap"
                  />
                </div>
                <div>
                  <Label htmlFor="max-loss">Max Loss/Day %</Label>
                  <Input
                    id="max-loss"
                    type="number"
                    value={maxDailyLoss}
                    onChange={(e) => setMaxDailyLoss(Number(e.target.value))}
                    className="input-monochrome mt-1"
                    data-testid="input-max-loss"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="per-symbol">Per-Symbol Cap ($)</Label>
                <Input
                  id="per-symbol"
                  type="number"
                  value={maxPerSymbol}
                  onChange={(e) => setMaxPerSymbol(Number(e.target.value))}
                  className="input-monochrome mt-1"
                  data-testid="input-per-symbol-cap"
                />
              </div>

              <div className="bg-dark-gray rounded-lg p-4 border border-white/10">
                <h4 className="text-sm font-medium mb-2">Summary</h4>
                <div className="text-sm text-silver space-y-1">
                  <p>Aggression: {aggression}% ({aggression < 33 ? 'Conservative' : aggression < 67 ? 'Moderate' : 'Aggressive'})</p>
                  <p>Max Leverage: {maxLeverage}x</p>
                  <p>Daily Loss Limit: {maxDailyLoss}%</p>
                  <p>Per-Symbol Cap: ${maxPerSymbol.toLocaleString()}</p>
                </div>
              </div>

              <Button
                onClick={handleFinish}
                className="btn-primary w-full text-lg py-6"
                data-testid="button-finish-onboarding"
              >
                Finish Setup & Go to Dashboard
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
