/**
 * Trade Page - Unified trading interface
 *
 * Combines Engine workflow (center) + Agent sidebar (right).
 * This is the main trading page that replaces both /engine and /agent routes.
 */

import { useState, useEffect } from 'react';
import { LeftNav } from '@/components/LeftNav';
import { Engine } from '@/pages/Engine';
import { AgentSidebar } from '@/components/agent/AgentSidebar';
import { useAgentOperator } from '@/hooks/useAgentOperator';

export function Trade() {
  // Agent operator hook for triggering analysis through Agent
  const { operate } = useAgentOperator({
    enableStatusPolling: true,
  });

  // Load Agent sidebar collapsed state from localStorage
  const [isAgentCollapsed, setIsAgentCollapsed] = useState(() => {
    const saved = localStorage.getItem('agent-sidebar-collapsed');
    // Default to collapsed on smaller screens
    if (saved !== null) return saved === 'true';
    return window.innerWidth < 1280; // Auto-collapse below 1280px
  });

  // Persist collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem('agent-sidebar-collapsed', String(isAgentCollapsed));
  }, [isAgentCollapsed]);

  // Auto-collapse on resize (responsive)
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1280 && !isAgentCollapsed) {
        setIsAgentCollapsed(true);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isAgentCollapsed]);

  const toggleAgentSidebar = () => setIsAgentCollapsed(!isAgentCollapsed);

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Left Navigation */}
      <LeftNav />

      {/* Engine Workflow (Center) - 55% of remaining space */}
      <div
        className="min-w-0 overflow-hidden"
        style={{ flex: isAgentCollapsed ? '1 0 0' : '55 0 0' }}
      >
        <Engine
          hideLeftNav={true}
          onAnalyze={() => operate('propose', {})}
        />
      </div>

      {/* Agent Sidebar (Right) - 45% of remaining space when expanded */}
      <AgentSidebar
        isCollapsed={isAgentCollapsed}
        onToggleCollapse={toggleAgentSidebar}
      />
    </div>
  );
}
