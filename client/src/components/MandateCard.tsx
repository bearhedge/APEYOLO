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
            <Shield className="w-6 h-6 text-zinc-300" />
            <h2 className="text-sm font-semibold tracking-[0.15em] uppercase text-zinc-300">
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
      <div className="p-8 space-y-10" style={{ fontFamily: 'Georgia, serif' }}>
        {/* Article I - Permitted Instruments */}
        <section>
          <h3 className="text-xs font-semibold tracking-[0.1em] uppercase text-silver mb-4">
            Article I - Permitted Instruments
          </h3>
          <div className="space-y-4 text-[15px] leading-[1.8] text-zinc-200">
            <p className="pl-8 relative">
              <span className="absolute left-0 text-zinc-500">1.1</span>
              The Manager shall trade only the following underlyings:
            </p>
            <ul className="pl-12 space-y-1">
              {mandate.allowedSymbols.map((symbol) => (
                <li key={symbol} className="font-medium">
                  {symbol === 'SPY' && 'SPY (SPDR S&P 500 ETF Trust)'}
                  {symbol === 'SPX' && 'SPX (S&P 500 Index)'}
                  {symbol !== 'SPY' && symbol !== 'SPX' && symbol}
                </li>
              ))}
            </ul>
            <p className="pl-8 relative">
              <span className="absolute left-0 text-zinc-500">1.2</span>
              All other securities are strictly prohibited.
            </p>
          </div>
        </section>

        {/* Article II - Strategy Constraints */}
        <section>
          <h3 className="text-xs font-semibold tracking-[0.1em] uppercase text-silver mb-4">
            Article II - Strategy Constraints
          </h3>
          <div className="space-y-4 text-[15px] leading-[1.8] text-zinc-200">
            <p className="pl-8 relative">
              <span className="absolute left-0 text-zinc-500">2.1</span>
              Only <span className="font-medium">{mandate.strategyType}</span> (credit) strategies are permitted.
            </p>
            <p className="pl-8 relative">
              <span className="absolute left-0 text-zinc-500">2.2</span>
              Delta range: <span className="font-medium">{mandate.minDelta.toFixed(2)} to {mandate.maxDelta.toFixed(2)}</span> (moderate out-of-the-money).
            </p>
            {mandate.tradingWindowStart && mandate.tradingWindowEnd && (
              <p className="pl-8 relative">
                <span className="absolute left-0 text-zinc-500">2.3</span>
                Trading window: <span className="font-medium">{formatTime(mandate.tradingWindowStart)} - {formatTime(mandate.tradingWindowEnd)}</span> (recommended).
              </p>
            )}
          </div>
        </section>

        {/* Article III - Risk Management */}
        <section>
          <h3 className="text-xs font-semibold tracking-[0.1em] uppercase text-silver mb-4">
            Article III - Risk Management
          </h3>
          <div className="space-y-4 text-[15px] leading-[1.8] text-zinc-200">
            {mandate.noOvernightPositions && (
              <p className="pl-8 relative">
                <span className="absolute left-0 text-zinc-500">3.1</span>
                No overnight positions. All positions must be closed by{' '}
                <span className="font-medium">{mandate.exitDeadline ? formatTime(mandate.exitDeadline) : '3:55 PM ET'}</span>,
                except 0DTE options expiring same day.
              </p>
            )}
            <p className="pl-8 relative">
              <span className="absolute left-0 text-zinc-500">3.2</span>
              Maximum daily loss: <span className="font-medium">{(mandate.maxDailyLossPercent * 100).toFixed(0)}% of NAV</span>.
              Upon reaching this threshold, all trading shall cease for the remainder of the trading day.
            </p>
          </div>
        </section>

        {/* Article IV - Immutability */}
        <section>
          <h3 className="text-xs font-semibold tracking-[0.1em] uppercase text-silver mb-4">
            Article IV - Immutability
          </h3>
          <div className="space-y-4 text-[15px] leading-[1.8] text-zinc-200">
            <p className="pl-8 relative">
              <span className="absolute left-0 text-zinc-500">4.1</span>
              This mandate is permanent and cannot be modified. To adopt new rules, a new mandate must be created.
            </p>
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
