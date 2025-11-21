import { Loader2 } from 'lucide-react';

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = 'Loading...' }: LoadingScreenProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-charcoal">
      <Loader2 className="w-8 h-8 animate-spin text-white mb-4" />
      <p className="text-silver text-sm uppercase tracking-wider">{message}</p>
    </div>
  );
}