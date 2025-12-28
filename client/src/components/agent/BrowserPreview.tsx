// client/src/components/agent/BrowserPreview.tsx
import { useAgentStore } from '@/lib/agentStore';

export function BrowserPreview() {
  const { browserScreenshots } = useAgentStore();
  const latestScreenshot = browserScreenshots[browserScreenshots.length - 1];

  if (!latestScreenshot) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-silver truncate">
        {latestScreenshot.url}
      </div>
      <img
        src={`data:image/jpeg;base64,${latestScreenshot.base64}`}
        alt="Browser view"
        className="w-full rounded border border-white/10"
      />
    </div>
  );
}
