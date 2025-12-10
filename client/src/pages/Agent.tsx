import { LeftNav } from '@/components/LeftNav';
import { ChatCanvas } from '@/components/ChatCanvas';
import { ContextPanel } from '@/components/ContextPanel';

export function Agent() {
  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <ChatCanvas initialMessage="Agent interface ready. Use commands like /analyze, /rebalance, /roll, or /explain to interact." />
      <ContextPanel />
    </div>
  );
}
