/**
 * RailsCard Component
 *
 * Displays a DeFi Rail in a formal legal document style.
 * Rails are permanent once created - cannot be modified, only replaced.
 */

import { ExternalLink, Clock, Shield } from 'lucide-react';
import type { Rail } from '@shared/types/rails';

interface RailsCardProps {
  rail: Rail;
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

export function RailsCard({
  rail,
  cluster = 'devnet',
}: RailsCardProps) {
  const isActive = rail.isActive;

  return (
    <div className="bg-charcoal rounded-2xl border border-white/10 shadow-lg overflow-hidden">
      {/* Document Header */}
      <div className="border-b border-white/10 p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Shield className="w-7 h-7 text-zinc-300" />
            <h2 className="text-lg font-semibold tracking-[0.15em] uppercase text-zinc-300">
              DeFi Rails
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
            <span>Effective: {formatDate(rail.createdAt)}</span>
          </div>
          {rail.onChainHash && (
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono text-silver bg-white/5 px-2 py-1 rounded">
                {rail.onChainHash.slice(0, 10)}...{rail.onChainHash.slice(-6)}
              </code>
              {rail.solanaSignature && (
                <a
                  href={getExplorerUrl(rail.solanaSignature, cluster)}
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
              {rail.allowedSymbols.map((symbol) => (
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
              Only <span className="font-medium">{rail.strategyType}</span> (credit) strategies are permitted.
            </p>
            <p className="pl-8 relative">
              <span className="absolute left-0 text-zinc-500">2.2</span>
              Delta range: <span className="font-medium">{rail.minDelta.toFixed(2)} to {rail.maxDelta.toFixed(2)}</span> (moderate out-of-the-money).
            </p>
            {rail.tradingWindowStart && rail.tradingWindowEnd && (
              <p className="pl-8 relative">
                <span className="absolute left-0 text-zinc-500">2.3</span>
                Trading window: <span className="font-medium">{formatTime(rail.tradingWindowStart)} - {formatTime(rail.tradingWindowEnd)}</span> (recommended).
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
            {rail.noOvernightPositions && (
              <p className="pl-8 relative">
                <span className="absolute left-0 text-zinc-500">3.1</span>
                No overnight positions. All positions must be closed by{' '}
                <span className="font-medium">{rail.exitDeadline ? formatTime(rail.exitDeadline) : '3:55 PM ET'}</span>,
                except 0DTE options expiring same day.
              </p>
            )}
            <p className="pl-8 relative">
              <span className="absolute left-0 text-zinc-500">3.2</span>
              Maximum daily loss: <span className="font-medium">{(rail.maxDailyLossPercent * 100).toFixed(0)}% of NAV</span>.
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
              This rail is permanent and cannot be modified. To adopt new rules, a new rail must be created.
            </p>
          </div>
        </section>
      </div>

      {/* Signature Section */}
      <div className="border-t border-white/10 px-8 py-6 bg-white/5">
        <div className="text-sm text-zinc-400 italic">
          Signed electronically on {formatDate(rail.createdAt)}
        </div>
        {rail.onChainHash && (
          <div className="mt-2">
            <span className="text-xs text-zinc-500">Hash: </span>
            <code className="text-xs font-mono text-zinc-400">
              {rail.onChainHash}
            </code>
          </div>
        )}
      </div>
    </div>
  );
}

export default RailsCard;
