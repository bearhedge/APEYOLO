import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Download } from "lucide-react";
import { useState } from "react";
import type { AuditLog } from "@shared/schema";

export default function Logs() {
  const [filter, setFilter] = useState('all');

  const { data: logs = [] } = useQuery<AuditLog[]>({
    queryKey: ['/api/logs'],
    refetchInterval: 30000,
  });

  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true;
    if (filter === 'trades') return log.eventType.includes('TRADE');
    if (filter === 'rules') return log.eventType.includes('RULES');
    if (filter === 'errors') return log.status === 'FAILED' || log.status === 'BLOCKED';
    return true;
  });

  const handleExportLogs = () => {
    const csvContent = [
      'Timestamp,Event Type,Details,User,Status',
      ...filteredLogs.map(log => 
        `${log.timestamp},${log.eventType},"${log.details}",${log.userId || ''},${log.status}`
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `orca_options_logs_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getEventBadgeVariant = (eventType: string) => {
    if (eventType.includes('TRADE_SUBMIT') || eventType.includes('TRADE_FILLED')) {
      return 'default'; // green
    }
    if (eventType.includes('TRADE_VALIDATE')) {
      return 'secondary'; // blue
    }
    if (eventType.includes('RULES')) {
      return 'outline'; // purple
    }
    if (eventType.includes('REJECT') || eventType.includes('ERROR')) {
      return 'destructive'; // red
    }
    return 'secondary';
  };

  const getStatusBadgeVariant = (status: string) => {
    if (status === 'SUCCESS' || status === 'PASSED' || status === 'APPLIED') {
      return 'default';
    }
    if (status === 'FAILED' || status === 'BLOCKED') {
      return 'destructive';
    }
    return 'secondary';
  };

  return (
    <div className="p-6 space-y-6">
      <Card>
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Audit Logs</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Append-only trail of all trading activities and rule changes
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  <SelectItem value="trades">Trades Only</SelectItem>
                  <SelectItem value="rules">Rule Changes</SelectItem>
                  <SelectItem value="errors">Errors</SelectItem>
                </SelectContent>
              </Select>
              <Button 
                variant="outline" 
                onClick={handleExportLogs}
                data-testid="button-export"
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </div>

        <CardContent className="p-0">
          <div className="overflow-auto max-h-[600px]">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left">Timestamp</th>
                  <th className="px-4 py-3 text-left">Event Type</th>
                  <th className="px-4 py-3 text-left">Details</th>
                  <th className="px-4 py-3 text-left">User</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No audit logs found
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    <tr 
                      key={log.id} 
                      className="border-b border-border hover:bg-secondary/30 transition-colors"
                      data-testid={`log-${log.id}`}
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        {new Date(log.timestamp).toLocaleString('en-US', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <Badge 
                          variant={getEventBadgeVariant(log.eventType)}
                          className="text-xs"
                        >
                          {log.eventType}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-sm max-w-md truncate" title={log.details}>
                        {log.details}
                      </td>
                      <td className="px-4 py-3">{log.userId || 'system'}</td>
                      <td className="px-4 py-3">
                        <Badge 
                          variant={getStatusBadgeVariant(log.status)}
                          className="text-xs"
                        >
                          {log.status}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
