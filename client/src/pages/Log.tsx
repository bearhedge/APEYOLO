import { LeftNav } from '@/components/LeftNav';
import { PeriodSummarySection } from '@/components/admin/PeriodSummarySection';

interface LogProps {
  hideLeftNav?: boolean;
  periodSummaryRows?: any[];
  trades?: any[];
  cluster?: 'devnet' | 'mainnet-beta';
  loading?: boolean;
  onAttest?: (period: string) => void;
}

export function Log({
  hideLeftNav = false,
  periodSummaryRows = [],
  trades = [],
  cluster = 'devnet',
  loading = false,
  onAttest,
}: LogProps) {
  return (
    <div className="flex h-[calc(100vh-64px)]">
      {!hideLeftNav && <LeftNav />}

      <div className="flex-1 overflow-y-auto bg-dark-gray p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-6">Trade Log</h1>

          <PeriodSummarySection
            periodRows={periodSummaryRows}
            trades={trades}
            cluster={cluster}
            loading={loading}
            onAttest={onAttest}
          />
        </div>
      </div>
    </div>
  );
}
