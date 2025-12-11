import { CheckCircle, XCircle, AlertCircle, Loader2, Minus } from 'lucide-react';

interface StatusStepProps {
  name: string;
  status: number | null;
  message: string;
  success?: boolean;
  compact?: boolean;
}

export function StatusStep({ name, status, message, success, compact }: StatusStepProps) {
  // Determine the icon and color based on status
  const getStatusDisplay = () => {
    if (status === null || status === 0) {
      // Not attempted
      return {
        icon: <Minus className={compact ? "w-4 h-4" : "w-5 h-5"} />,
        color: 'text-gray-400',
        bgColor: 'bg-gray-900/20',
        borderColor: 'border-gray-500/30'
      };
    } else if (status === 200 || success) {
      // Success
      return {
        icon: <CheckCircle className={compact ? "w-4 h-4" : "w-5 h-5"} />,
        color: 'text-green-400',
        bgColor: 'bg-green-900/20',
        borderColor: 'border-green-500/30'
      };
    } else if (status === 401 || status === 403) {
      // Authentication failure
      return {
        icon: <XCircle className={compact ? "w-4 h-4" : "w-5 h-5"} />,
        color: 'text-red-400',
        bgColor: 'bg-red-900/20',
        borderColor: 'border-red-500/30'
      };
    } else if (status > 0 && status < 200) {
      // In progress (1xx status codes)
      return {
        icon: <Loader2 className={`${compact ? "w-4 h-4" : "w-5 h-5"} animate-spin`} />,
        color: 'text-yellow-400',
        bgColor: 'bg-yellow-900/20',
        borderColor: 'border-yellow-500/30'
      };
    } else {
      // Other failure
      return {
        icon: <AlertCircle className={compact ? "w-4 h-4" : "w-5 h-5"} />,
        color: 'text-orange-400',
        bgColor: 'bg-orange-900/20',
        borderColor: 'border-orange-500/30'
      };
    }
  };

  const display = getStatusDisplay();

  // Compact mode: inline display with icon + name only
  if (compact) {
    return (
      <div className="flex items-center gap-1.5" title={message}>
        <span className={display.color}>{display.icon}</span>
        <span className={`text-sm ${display.color}`}>{name}</span>
      </div>
    );
  }

  // Full mode: card with details
  return (
    <div className={`p-3 rounded-lg border ${display.bgColor} ${display.borderColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={display.color}>{display.icon}</span>
          <div>
            <h4 className="text-sm font-medium">{name}</h4>
            <p className={`text-xs ${display.color}`}>{message}</p>
          </div>
        </div>
        {status !== null && status !== 0 && (
          <span className="text-xs text-silver font-mono">
            {status}
          </span>
        )}
      </div>
    </div>
  );
}
