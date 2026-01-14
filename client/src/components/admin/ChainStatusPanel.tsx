import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface ChainStatusPanelProps {
  sasReady: boolean;
  cluster: 'devnet' | 'mainnet-beta';
  attestationCount: number;
  checkingSas: boolean;
  sasError: string | null;
}

export function ChainStatusPanel({
  sasReady,
  cluster,
  attestationCount,
  checkingSas,
  sasError,
}: ChainStatusPanelProps) {
  return (
    <div>
      <h4 className="text-sm font-medium text-silver uppercase tracking-wider mb-4">
        Chain Status
      </h4>
      <div className="space-y-3">
        {/* SAS Status */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-silver">SAS Status</span>
          <div className="flex items-center gap-2">
            {checkingSas ? (
              <Loader2 className="w-4 h-4 text-silver animate-spin" />
            ) : sasReady ? (
              <CheckCircle className="w-4 h-4 text-green-400" />
            ) : (
              <XCircle className="w-4 h-4 text-red-400" />
            )}
            <span className="text-sm font-medium text-white">
              {sasReady ? 'Ready' : 'Pending Setup'}
            </span>
          </div>
        </div>

        {/* Cluster */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-silver">Cluster</span>
          <span className="text-sm font-medium text-white capitalize">
            {cluster}
          </span>
        </div>

        {/* Records */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-silver">Records</span>
          <span className="text-sm font-medium text-white">
            {attestationCount}
          </span>
        </div>

        {/* Error display */}
        {sasError && (
          <div className="text-xs text-red-400 mt-2">
            {sasError}
          </div>
        )}
      </div>
    </div>
  );
}
