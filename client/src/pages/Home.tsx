import { ArrowRight, Bot, Shield, TrendingUp, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocation } from 'wouter';

export function Home() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero Section */}
      <div className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-6xl md:text-7xl font-bold mb-4 tracking-wide" data-testid="text-hero-title">
            APEYOLO
          </h1>
          <p className="text-2xl md:text-3xl text-white mb-8 tracking-wide" data-testid="text-hero-tagline">
            THE SAFEST WAY TO YOLO.
          </p>
          <p className="text-lg text-silver/80 mb-12 max-w-2xl mx-auto" data-testid="text-hero-description">
            Automated options trading powered by AI. Professional-grade risk management. 
            Real-time execution. Built for systematic traders who value precision and control.
          </p>
          <Button
            onClick={() => { window.location.href = '/api/auth/google'; }}
            className="btn-primary text-lg px-8 py-6 h-auto"
            data-testid="button-get-started"
          >
            Get Started
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </div>
      </div>

      {/* Features Grid */}
      <div className="px-6 py-16 bg-charcoal/50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Why APEYOLO?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-charcoal rounded-2xl p-6 border border-white/10" data-testid="card-feature-ai">
              <Bot className="w-10 h-10 mb-4" />
              <h3 className="text-lg font-semibold mb-2">AI-Powered Agent</h3>
              <p className="text-sm text-silver">
                GPT-4 driven decision making with customizable strategies and safety rails
              </p>
            </div>

            <div className="bg-charcoal rounded-2xl p-6 border border-white/10" data-testid="card-feature-risk">
              <Shield className="w-10 h-10 mb-4" />
              <h3 className="text-lg font-semibold mb-2">Risk Management</h3>
              <p className="text-sm text-silver">
                Configurable limits, circuit breakers, and automated position management
              </p>
            </div>

            <div className="bg-charcoal rounded-2xl p-6 border border-white/10" data-testid="card-feature-execution">
              <Zap className="w-10 h-10 mb-4" />
              <h3 className="text-lg font-semibold mb-2">Fast Execution</h3>
              <p className="text-sm text-silver">
                Direct IBKR integration with sub-second order placement and fills
              </p>
            </div>

            <div className="bg-charcoal rounded-2xl p-6 border border-white/10" data-testid="card-feature-tracking">
              <TrendingUp className="w-10 h-10 mb-4" />
              <h3 className="text-lg font-semibold mb-2">Track Record</h3>
              <p className="text-sm text-silver">
                Immutable audit log with cryptographic hashing for compliance
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div className="px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
          <div className="space-y-8">
            <div className="flex gap-6 items-start">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-white text-black flex items-center justify-center font-bold">
                1
              </div>
              <div>
                <h3 className="text-xl font-semibold mb-2">Onboard in Minutes</h3>
                <p className="text-silver">
                  Connect your Google account, link IBKR via OAuth2, and set your risk preferences
                </p>
              </div>
            </div>

            <div className="flex gap-6 items-start">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-white text-black flex items-center justify-center font-bold">
                2
              </div>
              <div>
                <h3 className="text-xl font-semibold mb-2">Configure Your Agent</h3>
                <p className="text-silver">
                  Choose strategies (Cash-Secured Puts, Covered Calls), set symbols, and define automation rules
                </p>
              </div>
            </div>

            <div className="flex gap-6 items-start">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-white text-black flex items-center justify-center font-bold">
                3
              </div>
              <div>
                <h3 className="text-xl font-semibold mb-2">Monitor & Optimize</h3>
                <p className="text-silver">
                  Track positions in real-time, review immutable trade history, and refine your approach
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CTA Footer */}
      <div className="px-6 py-16 bg-charcoal/50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to Start Trading Smarter?</h2>
          <p className="text-silver mb-8">
            Join professional traders using APEYOLO for systematic, automated options trading
          </p>
          <Button
            onClick={() => { window.location.href = '/api/auth/google'; }}
            className="btn-primary text-lg px-8 py-6 h-auto"
            data-testid="button-get-started-footer"
          >
            Get Started Now
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}
