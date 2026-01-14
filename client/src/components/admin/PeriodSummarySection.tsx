import { PeriodSummaryTable } from '@/components/defi/PeriodSummaryTable';
import { TradeLogTable } from '@/components/defi/TradeLogTable';

interface PeriodSummarySectionProps {
  periodRows: any[];
  trades: any[];
  cluster: 'devnet' | 'mainnet-beta';
  loading: boolean;
  onAttest?: (period: string) => void;
}

export function PeriodSummarySection({
  periodRows,
  trades,
  cluster,
  loading,
  onAttest,
}: PeriodSummarySectionProps) {
  return (
    <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg space-y-6">
      <h3 className="text-lg font-semibold">On-Chain Performance</h3>

      {/* Period Summary Table */}
      <div className="w-full">
        <PeriodSummaryTable
          rows={periodRows}
          cluster={cluster}
          loading={loading}
          onAttest={onAttest}
        />
      </div>

      {/* Trade Log Table */}
      <div className="w-full overflow-x-auto">
        <TradeLogTable
          trades={trades}
          loading={loading}
        />
      </div>
    </div>
  );
}
