/**
 * MandateCard Component
 *
 * Displays a trading mandate in a formal legal document style.
 * Mandates are permanent once created - cannot be modified, only replaced.
 */

import { ExternalLink, AlertTriangle, CheckCircle, Clock, Shield } from 'lucide-react';
import type { Mandate, Violation } from '@shared/types/mandate';

interface MandateCardProps {
  mandate: Mandate;
  violations: Violation[];
  violationCount: number;
  monthlyViolations: number;
  onViewViolations?: () => void;
  cluster?: 'devnet' | 'mainnet-beta';
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const h = hours % 12 || 12;
  const ampm = hours < 12 ? 'AM' : 'PM';
  return `${h}:${minutes.toString().padStart(2, '0')} ${ampm} ET`;
}

function getExplorerUrl(signature: string, cluster: 'devnet' | 'mainnet-beta' = 'devnet'): string {
  const baseUrl = cluster === 'devnet'
    ? 'https://explorer.solana.com/tx/'
    : 'https://explorer.solana.com/tx/';
  return `${baseUrl}${signature}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
}

export function MandateCard({
  mandate,
  violations,
  violationCount,
  monthlyViolations,
  onViewViolations,
  cluster = 'devnet',
}: MandateCardProps) {
  const isActive = mandate.isActive;

  return (
    <div className="bg-charcoal rounded-2xl border border-white/10 shadow-lg overflow-hidden">
      {/* Document Header */}
      <div className="border-b border-white/10 p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Shield className="w-7 h-7 text-zinc-300" />
            <h2 className="text-lg font-semibold tracking-[0.12em] uppercase text-zinc-300">
              Trading Mandate
            </h2>
          </div>
          <div className={`px-3 py-1 text-xs font-medium rounded-full ${
            isActive
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-zinc-500/20 text-zinc-400 border border-zinc-500/30'
          }`}>
            {isActive ? 'ACTIVE' : 'INACTIVE'}
          </div>
        </div>

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-silver">
            <Clock className="w-4 h-4" />
            <span>Effective: {formatDate(mandate.createdAt)}</span>
          </div>
          {mandate.onChainHash && (
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono text-silver bg-white/5 px-2 py-1 rounded">
                {mandate.onChainHash.slice(0, 10)}...{mandate.onChainHash.slice(-6)}
              </code>
              {mandate.solanaSignature && (
                <a
                  href={getExplorerUrl(mandate.solanaSignature, cluster)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-electric hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Document Body - Legal Articles */}
      <div className="px-8 py-10 space-y-10" style={{ fontFamily: 'Georgia, serif' }}>
        {/* Article I - Permitted Instruments */}
        <section>
          <h3 className="text-sm font-semibold tracking-[0.15em] uppercase text-silver mb-6 pb-2 border-b border-white/5">
            Article I — Permitted Instruments
          </h3>
          <div className="space-y-5 text-[15px] leading-relaxed text-zinc-300">
            <div className="flex gap-4">
              <span className="text-zinc-500 font-mono text-sm w-8 flex-shrink-0">1.1</span>
              <span>The Manager shall trade options only on the following underlyings:</span>
            </div>
            <ul className="ml-12 space-y-2">
              {mandate.allowedSymbols.map((symbol) => (
                <li key={symbol} className="text-white font-medium flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-electric rounded-full" />
                  {symbol === 'SPY' && 'SPY (SPDR S&P 500 ETF Trust)'}
                  {symbol === 'SPX' && 'SPX (S&P 500 Index)'}
                  {symbol !== 'SPY' && symbol !== 'SPX' && symbol}
                </li>
              ))}
            </ul>
            <div className="flex gap-4">
              <span className="text-zinc-500 font-mono text-sm w-8 flex-shrink-0">1.2</span>
              <span>All other securities are strictly prohibited.</span>
            </div>
          </div>
        </section>

        {/* Article II - Strategy Constraints */}
        <section>
          <h3 className="text-sm font-semibold tracking-[0.15em] uppercase text-silver mb-6 pb-2 border-b border-white/5">
            Article II — Strategy Constraints
          </h3>
          <div className="space-y-5 text-[15px] leading-relaxed text-zinc-300">
            <div className="flex gap-4">
              <span className="text-zinc-500 font-mono text-sm w-8 flex-shrink-0">2.1</span>
              <span>All trades must begin with a <span className="text-white font-medium">short (sell)</span> to collect premium.</span>
            </div>
            <div className="flex gap-4">
              <span className="text-zinc-500 font-mono text-sm w-8 flex-shrink-0">2.2</span>
              <span>Delta range: <span className="text-white font-medium">{mandate.minDelta.toFixed(2)} to {mandate.maxDelta.toFixed(2)}</span> (moderate out-of-the-money).</span>
            </div>
            {mandate.tradingWindowStart && mandate.tradingWindowEnd && (
              <div className="flex gap-4">
                <span className="text-zinc-500 font-mono text-sm w-8 flex-shrink-0">2.3</span>
                <span>Trading window: <span className="text-white font-medium">{formatTime(mandate.tradingWindowStart)} – {formatTime(mandate.tradingWindowEnd)}</span> (recommended).</span>
              </div>
            )}
          </div>
        </section>

        {/* Article III - Risk Management */}
        <section>
          <h3 className="text-sm font-semibold tracking-[0.15em] uppercase text-silver mb-6 pb-2 border-b border-white/5">
            Article III — Risk Management
          </h3>
          <div className="space-y-5 text-[15px] leading-relaxed text-zinc-300">
            {mandate.noOvernightPositions && (
              <div className="flex gap-4">
                <span className="text-zinc-500 font-mono text-sm w-8 flex-shrink-0">3.1</span>
                <span>
                  No overnight positions. All positions must be closed by{' '}
                  <span className="text-white font-medium">{mandate.exitDeadline ? formatTime(mandate.exitDeadline) : '3:55 PM ET'}</span>{' '}
                  unless the option has a high probability of expiring worthless.
                </span>
              </div>
            )}
            <div className="flex gap-4">
              <span className="text-zinc-500 font-mono text-sm w-8 flex-shrink-0">3.2</span>
              <span>
                Maximum daily loss: <span className="text-white font-medium">{(mandate.maxDailyLossPercent * 100).toFixed(0)}% of NAV</span>.
                Upon reaching this threshold, all trading shall cease for the remainder of the trading day.
              </span>
            </div>
          </div>
        </section>

        {/* Article IV - Immutability */}
        <section>
          <h3 className="text-sm font-semibold tracking-[0.15em] uppercase text-silver mb-6 pb-2 border-b border-white/5">
            Article IV — Immutability
          </h3>
          <div className="space-y-5 text-[15px] leading-relaxed text-zinc-300">
            <div className="flex gap-4">
              <span className="text-zinc-500 font-mono text-sm w-8 flex-shrink-0">4.1</span>
              <span>This mandate is permanent and cannot be modified. To adopt new rules, a new mandate must be created.</span>
            </div>
          </div>
        </section>
      </div>

      {/* Violations Section */}
      <div className="border-t border-white/10 px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {violationCount === 0 ? (
              <div className="flex items-center gap-2 text-green-400">
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm font-medium">No violations</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-amber-400">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {violationCount} violation{violationCount !== 1 ? 's' : ''} total
                  {monthlyViolations > 0 && ` (${monthlyViolations} this month)`}
                </span>
              </div>
            )}
          </div>
          {violationCount > 0 && onViewViolations && (
            <button
              onClick={onViewViolations}
              className="text-sm text-electric hover:underline"
            >
              View History
            </button>
          )}
        </div>
      </div>

      {/* Signature Section */}
      <div className="border-t border-white/10 px-8 py-6 bg-white/5">
        <div className="text-sm text-zinc-400 italic" style={{ fontFamily: 'Georgia, serif' }}>
          Signed electronically on {formatDate(mandate.createdAt)}
        </div>
        {mandate.onChainHash && (
          <div className="mt-2">
            <span className="text-xs text-zinc-500">Hash: </span>
            <code className="text-xs font-mono text-zinc-400">
              {mandate.onChainHash}
            </code>
          </div>
        )}
      </div>
    </div>
  );
}

export default MandateCard;
