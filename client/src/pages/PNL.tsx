import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { Download, Link as LinkIcon } from 'lucide-react';
import { DataTable } from '@/components/DataTable';
import { SectionHeader } from '@/components/SectionHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getPNL } from '@/lib/api';
import { LeftNav } from '@/components/LeftNav';
import type { PnlRow } from '@shared/types';

export function PNL() {
  const [symbolFilter, setSymbolFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data, isLoading, error } = useQuery<PnlRow[]>({
    queryKey: ['/api/pnl'],
    queryFn: getPNL,
  });

  const filteredData = (data || []).filter((row) => {
    const symbolMatch = !symbolFilter || row.symbol.toLowerCase().includes(symbolFilter.toLowerCase());
    const dateMatch = (!dateFrom || new Date(row.ts) >= new Date(dateFrom)) &&
                     (!dateTo || new Date(row.ts) <= new Date(dateTo));
    return symbolMatch && dateMatch;
  });

  const [recordHash, setRecordHash] = useState<string>('');
  const [datasetHash, setDatasetHash] = useState<string>('');
  const [rowHashes, setRowHashes] = useState<Map<string, string>>(new Map());

  const hashString = async (data: string): Promise<string> => {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const computeRowHash = async (row: PnlRow): Promise<string> => {
    const rowData = JSON.stringify(row);
    const hash = await hashString(rowData);
    return hash.substring(0, 8);
  };

  const computeDatasetHash = async (hashes: string[]): Promise<string> => {
    const combinedHashes = hashes.join('');
    return await hashString(combinedHashes);
  };

  const calculateHashes = async () => {
    const newRowHashes = new Map<string, string>();
    const hashPromises = filteredData.map(async (row) => {
      const hash = await computeRowHash(row);
      newRowHashes.set(row.tradeId, hash);
      return hash;
    });

    const hashes = await Promise.all(hashPromises);
    setRowHashes(newRowHashes);

    if (hashes.length > 0) {
      const dHash = await computeDatasetHash(hashes);
      setDatasetHash(dHash);
    }
  };

  const exportCSV = async () => {
    const headers = ['Trade ID', 'Timestamp', 'Symbol', 'Strategy', 'Side', 'Qty', 'Entry', 'Exit', 'Fees', 'Realized P/L', 'Run P/L', 'Notes'];
    const rows = filteredData.map(row => [
      row.tradeId,
      row.ts,
      row.symbol,
      row.strategy,
      row.side,
      row.qty,
      row.entry,
      row.exit || '',
      row.fees,
      row.realized,
      row.run,
      row.notes || ''
    ]);
    
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pnl_export_${new Date().toISOString()}.csv`;
    a.click();
    
    const hash = await hashString(csv);
    setRecordHash(hash);
  };

  const exportJSON = async () => {
    const json = JSON.stringify(filteredData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pnl_export_${new Date().toISOString()}.json`;
    a.click();
    
    const hash = await hashString(json);
    setRecordHash(hash);
  };

  useEffect(() => {
    if (filteredData.length > 0) {
      calculateHashes();
    }
  }, [filteredData]);

  // Helper to safely format numbers
  const formatMoney = (val: number | null | undefined): string => {
    if (val == null || isNaN(val)) return '-';
    return `$${val.toFixed(2)}`;
  };

  const pnlColumns = [
    { header: 'Trade ID', accessor: 'tradeId' as keyof PnlRow, sortable: true },
    { header: 'Timestamp', accessor: (row: PnlRow) => row.ts ? new Date(row.ts).toLocaleString() : '-', sortable: true },
    { header: 'Symbol', accessor: 'symbol' as keyof PnlRow, sortable: true },
    { header: 'Strategy', accessor: 'strategy' as keyof PnlRow, sortable: true },
    { header: 'Side', accessor: 'side' as keyof PnlRow, sortable: true },
    { header: 'Qty', accessor: 'qty' as keyof PnlRow, sortable: true, className: 'tabular-nums' },
    { header: 'Entry', accessor: (row: PnlRow) => formatMoney(row.entry), className: 'tabular-nums' },
    { header: 'Exit', accessor: (row: PnlRow) => formatMoney(row.exit), className: 'tabular-nums' },
    { header: 'Fees', accessor: (row: PnlRow) => formatMoney(row.fees), className: 'tabular-nums' },
    {
      header: 'Realized P/L',
      accessor: (row: PnlRow) => {
        if (row.realized == null || isNaN(row.realized)) return '-';
        return (
          <span className={row.realized >= 0 ? 'text-green-500' : 'text-red-500'}>
            ${row.realized.toFixed(2)}
          </span>
        );
      },
      className: 'tabular-nums'
    },
    {
      header: 'Run P/L',
      accessor: (row: PnlRow) => {
        if (row.run == null || isNaN(row.run)) return '-';
        return (
          <span className={row.run >= 0 ? 'text-green-500' : 'text-red-500'}>
            ${row.run.toFixed(2)}
          </span>
        );
      },
      className: 'tabular-nums'
    },
    { header: 'Notes', accessor: (row: PnlRow) => row.notes || '-', className: 'text-sm text-silver' },
    {
      header: 'Row Hash',
      accessor: (row: PnlRow) => (
        <span className="font-mono text-xs">{rowHashes.get(row.tradeId) || '...'}</span>
      ),
      className: 'text-sm'
    },
  ];

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-64px)]">
        <LeftNav />
        <div className="flex-1 p-6 space-y-6">
          <div className="skeleton h-8 w-48" />
          <div className="skeleton h-96" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[calc(100vh-64px)]">
        <LeftNav />
        <div className="flex-1 p-6 space-y-6">
          <SectionHeader
            title="Track Record"
            subtitle="Immutable trading history - read-only audit log"
            testId="header-pnl"
          />
          <div className="bg-charcoal rounded-2xl p-6 border border-red-500/50">
            <p className="text-red-500">Failed to load PNL data: {error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <SectionHeader
          title="Track Record"
          subtitle="Immutable trading history - read-only audit log"
          testId="header-pnl"
        />

      <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1">
            <Label htmlFor="symbol-filter">Symbol Filter</Label>
            <Input
              id="symbol-filter"
              placeholder="Filter by symbol..."
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
              className="input-monochrome mt-1"
              data-testid="input-symbol-filter"
            />
          </div>
          <div className="flex-1">
            <Label htmlFor="date-from">Date From</Label>
            <Input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="input-monochrome mt-1"
              data-testid="input-date-from"
            />
          </div>
          <div className="flex-1">
            <Label htmlFor="date-to">Date To</Label>
            <Input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="input-monochrome mt-1"
              data-testid="input-date-to"
            />
          </div>
          <div className="flex items-end gap-2">
            <Button
              onClick={exportCSV}
              className="btn-secondary"
              data-testid="button-export-csv"
            >
              <Download className="w-4 h-4 mr-2" />
              CSV
            </Button>
            <Button
              onClick={exportJSON}
              className="btn-secondary"
              data-testid="button-export-json"
            >
              <Download className="w-4 h-4 mr-2" />
              JSON
            </Button>
          </div>
        </div>

        <DataTable
          data={filteredData}
          columns={pnlColumns}
          testId="table-pnl"
        />

        {recordHash && (
          <div className="mt-6 p-4 bg-dark-gray rounded-lg border border-white/10">
            <p className="text-sm text-silver mb-1">Export Hash (SHA-256):</p>
            <p className="font-mono text-xs text-white break-all" data-testid="text-record-hash">
              {recordHash}
            </p>
          </div>
        )}

        {datasetHash && (
          <div className="mt-6 p-4 bg-dark-gray rounded-lg border border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm text-silver mb-1">Dataset Hash (SHA-256):</p>
                <p className="font-mono text-xs text-white break-all" data-testid="text-dataset-hash">
                  {datasetHash}
                </p>
              </div>
              <Button
                disabled
                className="btn-secondary ml-4"
                data-testid="button-anchor-chain"
              >
                <LinkIcon className="w-4 h-4 mr-2" />
                Anchor to Chain
              </Button>
            </div>
            <p className="text-xs text-silver mt-2">
              This cryptographic hash represents the immutable state of your entire trading history
            </p>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
