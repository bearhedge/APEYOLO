/**
 * Toolbox Component - Shows available tools for the agent
 *
 * Displays all tools the AI can use, organized by category.
 * Helps track tool inventory and prevent duplication.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench, Clock, BarChart3, Wallet, Globe, Brain, TrendingUp } from 'lucide-react';

// Tool categories with icons
const TOOL_CATEGORIES = {
  time: { name: 'Time & Date', icon: Clock },
  market: { name: 'Market Data', icon: BarChart3 },
  portfolio: { name: 'Portfolio', icon: Wallet },
  trading: { name: 'Trading', icon: TrendingUp },
  web: { name: 'Web & Search', icon: Globe },
  reasoning: { name: 'Reasoning', icon: Brain },
} as const;

type CategoryKey = keyof typeof TOOL_CATEGORIES;

// Tool definitions (mirror of server-side tools)
interface ToolDef {
  name: string;
  category: CategoryKey;
  description: string;
  parameters?: string[];
}

const TOOLS: ToolDef[] = [
  {
    name: 'get_current_time',
    category: 'time',
    description: 'Get current date/time in HK, NY, and UTC timezones',
  },
  {
    name: 'get_market_data',
    category: 'market',
    description: 'Get SPY price, VIX level, and market open/close status',
  },
  {
    name: 'get_positions',
    category: 'portfolio',
    description: 'Get portfolio positions, P&L, and account value',
  },
  {
    name: 'run_engine',
    category: 'trading',
    description: 'Run 0DTE trading engine to find trade opportunities',
    parameters: ['strategy: strangle | put-only | call-only'],
  },
  {
    name: 'execute_trade',
    category: 'trading',
    description: 'Execute a trade (requires human approval)',
    parameters: ['symbol', 'side', 'strike', 'contracts'],
  },
  {
    name: 'close_trade',
    category: 'trading',
    description: 'Close an existing position',
    parameters: ['positionId'],
  },
  {
    name: 'think_deeply',
    category: 'reasoning',
    description: 'Deep reasoning for complex analysis and trade decisions',
    parameters: ['query', 'context?'],
  },
  {
    name: 'web_browse',
    category: 'web',
    description: 'Search web for factual info (schedules, holidays, etc.)',
    parameters: ['query', 'url?'],
  },
];

// Group tools by category
function groupByCategory(tools: ToolDef[]): Record<CategoryKey, ToolDef[]> {
  const grouped: Record<CategoryKey, ToolDef[]> = {
    time: [],
    market: [],
    portfolio: [],
    trading: [],
    web: [],
    reasoning: [],
  };

  for (const tool of tools) {
    grouped[tool.category].push(tool);
  }

  return grouped;
}

interface ToolboxProps {
  collapsed?: boolean;
}

export function Toolbox({ collapsed = true }: ToolboxProps) {
  const [isExpanded, setIsExpanded] = useState(!collapsed);
  const [expandedCategories, setExpandedCategories] = useState<Set<CategoryKey>>(new Set());

  const groupedTools = groupByCategory(TOOLS);
  const totalTools = TOOLS.length;

  const toggleCategory = (category: CategoryKey) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  return (
    <div className="bg-dark-gray border border-white/20">
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 border-b border-white/10 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-silver" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-silver">
            Toolbox
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-white bg-white/10 px-2 py-0.5 rounded">
            {totalTools} tools
          </span>
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-silver" />
          ) : (
            <ChevronRight className="w-4 h-4 text-silver" />
          )}
        </div>
      </button>

      {/* Content - collapsible */}
      {isExpanded && (
        <div className="p-2 space-y-1 max-h-80 overflow-y-auto">
          {(Object.keys(TOOL_CATEGORIES) as CategoryKey[]).map((categoryKey) => {
            const category = TOOL_CATEGORIES[categoryKey];
            const tools = groupedTools[categoryKey];
            const isOpen = expandedCategories.has(categoryKey);
            const Icon = category.icon;

            if (tools.length === 0) return null;

            return (
              <div key={categoryKey} className="border border-white/10 rounded">
                <button
                  onClick={() => toggleCategory(categoryKey)}
                  className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5 text-silver" />
                    <span className="text-xs font-medium text-white">
                      {category.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-silver">{tools.length}</span>
                    {isOpen ? (
                      <ChevronDown className="w-3 h-3 text-silver" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-silver" />
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div className="px-3 pb-2 space-y-2">
                    {tools.map((tool) => (
                      <div
                        key={tool.name}
                        className="pl-5 border-l border-white/10"
                      >
                        <div className="text-xs font-mono text-white/80">
                          {tool.name}
                        </div>
                        <div className="text-xs text-silver mt-0.5">
                          {tool.description}
                        </div>
                        {tool.parameters && (
                          <div className="text-xs text-silver/60 mt-0.5 font-mono">
                            params: {tool.parameters.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
