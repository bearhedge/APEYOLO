import { LeftNav } from '@/components/LeftNav';
import { StatCard } from '@/components/StatCard';
import { CheckCircle, XCircle, Clock, Zap } from 'lucide-react';

export function Engine() {
  // Mock engine status for now - will connect to API later
  const engineStatus = {
    canTrade: true,
    lastCheck: new Date().toLocaleTimeString(),
    nextWindow: '12:00 PM EST',
  };

  // Mock 5-step status - will come from backend
  const steps = [
    { name: 'Market Regime', status: 'passed', detail: 'Trading window open' },
    { name: 'Direction', status: 'passed', detail: 'STRANGLE selected' },
    { name: 'Strikes', status: 'passed', detail: '445P / 455C (δ 0.18)' },
    { name: 'Position Size', status: 'passed', detail: '3 contracts' },
    { name: 'Exit Rules', status: 'passed', detail: 'Stop at $150' },
  ];

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-wide">Engine</h1>
          <p className="text-silver text-sm mt-1">Automated trading decision engine</p>
        </div>

        {/* Engine Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard
            label="Engine Status"
            value={engineStatus.canTrade ? 'READY' : 'WAITING'}
            icon={engineStatus.canTrade ? <CheckCircle className="w-5 h-5 text-green-500" /> : <Clock className="w-5 h-5" />}
            testId="engine-status"
          />
          <StatCard
            label="Last Check"
            value={engineStatus.lastCheck}
            icon={<Zap className="w-5 h-5" />}
            testId="last-check"
          />
          <StatCard
            label="Next Window"
            value={engineStatus.nextWindow}
            icon={<Clock className="w-5 h-5" />}
            testId="next-window"
          />
        </div>

        {/* 5-Step Decision Process */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Decision Process</h3>
          <div className="space-y-4">
            {steps.map((step, index) => (
              <div key={index} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
                <div className="flex items-center space-x-4">
                  <span className="text-silver text-sm font-mono">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <p className="font-medium">{step.name}</p>
                    <p className="text-sm text-silver">{step.detail}</p>
                  </div>
                </div>
                <div>
                  {step.status === 'passed' ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : step.status === 'failed' ? (
                    <XCircle className="w-5 h-5 text-red-500" />
                  ) : (
                    <Clock className="w-5 h-5 text-silver" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Current Decision */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Current Decision</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-silver mb-1">Strategy</p>
              <p className="font-medium">STRANGLE</p>
            </div>
            <div>
              <p className="text-xs text-silver mb-1">Strikes</p>
              <p className="font-medium">445P / 455C</p>
            </div>
            <div>
              <p className="text-xs text-silver mb-1">Premium</p>
              <p className="font-medium">$125</p>
            </div>
            <div>
              <p className="text-xs text-silver mb-1">Margin</p>
              <p className="font-medium">$5,400</p>
            </div>
          </div>

          {/* Execute Button */}
          <div className="mt-6 flex gap-3">
            <button className="px-6 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-100 transition">
              Execute Trade
            </button>
            <button className="px-6 py-2 border border-white/20 rounded-lg hover:bg-white/5 transition">
              Skip Today
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}