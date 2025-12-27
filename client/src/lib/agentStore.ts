/**
 * Agent State Store
 *
 * Zustand store for managing the autonomous trading agent's state.
 * Tracks reasoning, plans, actions, and validation status.
 * Receives updates from SSE events.
 */

import { create } from 'zustand';

// Types for agent state
export type AgentPhase = 'idle' | 'thinking' | 'planning' | 'executing' | 'validating' | 'responding' | 'error';

export interface Position {
  id: string;
  symbol: string;
  side: 'PUT' | 'CALL';
  strike: number;
  contracts: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
}

export interface AgentContext {
  vix: number;
  spyPrice: number;
  positions: Position[];
  marketOpen: boolean;
  lastUpdate: number;
}

export interface PlanStep {
  step: string;
  status: 'pending' | 'active' | 'done' | 'skipped';
}

export interface AgentAction {
  id: string;
  tool: string;
  args?: Record<string, any>;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: any;
  error?: string;
  timestamp: number;
}

export interface AgentValidation {
  status: 'pending' | 'approved' | 'rejected' | 'none';
  feedback: string;
  timestamp: number;
}

// New types for Manus-style plan/step events
export interface TaskStep {
  id: number;
  description: string;
  status: 'pending' | 'running' | 'complete' | 'error';
}

export interface WorkspaceData {
  [key: string]: string;
}

// Activity Log Entry for UI display (matches server type)
export interface ActivityLogEntry {
  id: string;
  timestamp: number;
  eventType: string;
  title: string;
  summary?: string;
  details?: {
    args?: Record<string, unknown>;
    result?: unknown;
    durationMs?: number;
    reasoning?: string;
    screenshotBase64?: string;
    url?: string;
  };
  isExpandable: boolean;
}

export interface BrowserScreenshot {
  base64: string;
  url: string;
  timestamp: number;
}

export interface AgentSSEEvent {
  type: 'status' | 'reasoning' | 'chunk' | 'action' | 'validation' | 'done' | 'error' | 'context' | 'plan' | 'step' | 'data';
  phase?: AgentPhase;
  content?: string;
  isComplete?: boolean;
  fullContent?: string;
  reasoning?: string;
  tool?: string;
  args?: Record<string, any>;
  result?: any;
  approved?: boolean;
  feedback?: string;
  error?: string;
  context?: Partial<AgentContext>;
  // Plan events
  steps?: TaskStep[];
  // Step events
  stepId?: number;
  status?: 'pending' | 'running' | 'complete' | 'error';
  // Data events
  key?: string;
  value?: string;
}

interface AgentState {
  // Core state
  isRunning: boolean;
  phase: AgentPhase;

  // Context (market data, positions)
  context: AgentContext;

  // Reasoning (from DeepSeek <think> blocks)
  reasoning: string;
  reasoningBuffer: string; // For streaming accumulation

  // Current response
  currentResponse: string;

  // Plan (steps the agent intends to take)
  plan: PlanStep[];

  // Manus-style task steps
  taskSteps: TaskStep[];

  // Workspace data (key-value pairs from tools)
  workspaceData: WorkspaceData;

  // Activity log (Manus-style event visibility)
  activityLog: ActivityLogEntry[];
  browserScreenshots: BrowserScreenshot[];

  // Actions (tool calls)
  actions: AgentAction[];

  // Validation (from Qwen Critic)
  validation: AgentValidation;

  // Message history for display
  lastMessage: string;

  // Actions
  startAgent: () => void;
  stopAgent: () => void;
  resetState: () => void;
  setPhase: (phase: AgentPhase) => void;
  setContext: (context: Partial<AgentContext>) => void;
  appendReasoning: (content: string, isComplete?: boolean) => void;
  appendResponse: (content: string) => void;
  setResponse: (content: string) => void;
  addPlanStep: (step: string) => void;
  updatePlanStep: (index: number, status: PlanStep['status']) => void;
  clearPlan: () => void;
  setTaskSteps: (steps: TaskStep[]) => void;
  updateTaskStep: (stepId: number, status: TaskStep['status']) => void;
  clearTaskSteps: () => void;
  setWorkspaceData: (key: string, value: string) => void;
  clearWorkspaceData: () => void;
  addActivityEntry: (entry: ActivityLogEntry) => void;
  addBrowserScreenshot: (screenshot: BrowserScreenshot) => void;
  clearActivityLog: () => void;
  addAction: (tool: string, args?: Record<string, any>) => string;
  updateAction: (id: string, update: Partial<AgentAction>) => void;
  setValidation: (status: AgentValidation['status'], feedback?: string) => void;
  handleSSEEvent: (event: AgentSSEEvent) => void;
}

const initialContext: AgentContext = {
  vix: 0,
  spyPrice: 0,
  positions: [],
  marketOpen: false,
  lastUpdate: 0,
};

const initialValidation: AgentValidation = {
  status: 'none',
  feedback: '',
  timestamp: 0,
};

export const useAgentStore = create<AgentState>()((set, get) => ({
  // Initial state
  isRunning: false,
  phase: 'idle',
  context: initialContext,
  reasoning: '',
  reasoningBuffer: '',
  currentResponse: '',
  plan: [],
  taskSteps: [],
  workspaceData: {},
  activityLog: [],
  browserScreenshots: [],
  actions: [],
  validation: initialValidation,
  lastMessage: '',

  // Actions
  startAgent: () => set({ isRunning: true, phase: 'idle' }),

  stopAgent: () => set({
    isRunning: false,
    phase: 'idle',
  }),

  resetState: () => set({
    phase: 'idle',
    reasoning: '',
    reasoningBuffer: '',
    currentResponse: '',
    plan: [],
    taskSteps: [],
    workspaceData: {},
    actions: [],
    validation: initialValidation,
  }),

  setPhase: (phase) => set({ phase }),

  setContext: (contextUpdate) => set((state) => ({
    context: {
      ...state.context,
      ...contextUpdate,
      lastUpdate: Date.now(),
    },
  })),

  appendReasoning: (content, isComplete = false) => set((state) => {
    if (isComplete) {
      // Complete reasoning block received
      return {
        reasoning: content,
        reasoningBuffer: '',
      };
    }
    // Streaming - append to buffer
    return {
      reasoningBuffer: state.reasoningBuffer + content,
      reasoning: state.reasoningBuffer + content,
    };
  }),

  appendResponse: (content) => set((state) => ({
    currentResponse: state.currentResponse + content,
  })),

  setResponse: (content) => set({
    currentResponse: content,
    lastMessage: content,
  }),

  addPlanStep: (step) => set((state) => ({
    plan: [...state.plan, { step, status: 'pending' }],
  })),

  updatePlanStep: (index, status) => set((state) => ({
    plan: state.plan.map((s, i) => i === index ? { ...s, status } : s),
  })),

  clearPlan: () => set({ plan: [] }),

  // Manus-style task steps
  setTaskSteps: (steps) => set({ taskSteps: steps }),

  updateTaskStep: (stepId, status) => set((state) => ({
    taskSteps: state.taskSteps.map((s) =>
      s.id === stepId ? { ...s, status } : s
    ),
  })),

  clearTaskSteps: () => set({ taskSteps: [], workspaceData: {} }),

  // Workspace data
  setWorkspaceData: (key, value) => set((state) => ({
    workspaceData: { ...state.workspaceData, [key]: value },
  })),

  clearWorkspaceData: () => set({ workspaceData: {} }),

  // Activity log
  addActivityEntry: (entry) => set((state) => ({
    activityLog: [...state.activityLog, entry].slice(-50), // Keep last 50
  })),

  addBrowserScreenshot: (screenshot) => set((state) => ({
    browserScreenshots: [...state.browserScreenshots, screenshot].slice(-10),
  })),

  clearActivityLog: () => set({ activityLog: [], browserScreenshots: [] }),

  addAction: (tool, args) => {
    const id = `action_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({
      actions: [...state.actions, {
        id,
        tool,
        args,
        status: 'pending',
        timestamp: Date.now(),
      }],
    }));
    return id;
  },

  updateAction: (id, update) => set((state) => ({
    actions: state.actions.map((a) =>
      a.id === id ? { ...a, ...update } : a
    ),
  })),

  setValidation: (status, feedback = '') => set({
    validation: {
      status,
      feedback,
      timestamp: Date.now(),
    },
  }),

  // Handle SSE events from server
  handleSSEEvent: (event) => {
    const { type, phase, content, isComplete, fullContent, reasoning, error, context } = event;

    switch (type) {
      case 'status':
        if (phase) {
          set({ phase });
        }
        break;

      case 'reasoning':
        if (content) {
          get().appendReasoning(content, isComplete);
        }
        break;

      case 'chunk':
        if (content) {
          get().appendResponse(content);
        }
        break;

      case 'done':
        set({
          phase: 'idle',
          lastMessage: fullContent || get().currentResponse,
        });
        if (reasoning) {
          set({ reasoning });
        }
        break;

      case 'action':
        // Handle tool execution events
        if (event.tool) {
          const existingAction = get().actions.find(a => a.tool === event.tool && a.status === 'running');
          if (existingAction) {
            get().updateAction(existingAction.id, {
              status: event.result ? 'done' : 'running',
              result: event.result,
            });
          } else {
            const id = get().addAction(event.tool, event.args);
            get().updateAction(id, { status: 'running' });
          }
        }
        break;

      case 'validation':
        get().setValidation(
          event.approved ? 'approved' : 'rejected',
          event.feedback || ''
        );
        break;

      case 'context':
        if (context) {
          get().setContext(context);
        }
        break;

      // Manus-style plan events
      case 'plan':
        if (event.steps) {
          // Clear previous state and set new plan
          get().clearTaskSteps();
          get().setTaskSteps(event.steps);
        }
        break;

      case 'step':
        if (event.stepId !== undefined && event.status) {
          get().updateTaskStep(event.stepId, event.status);
        }
        break;

      case 'data':
        if (event.key && event.value !== undefined) {
          get().setWorkspaceData(event.key, event.value);
        }
        break;

      case 'error':
        set({
          phase: 'error',
        });
        break;
    }
  },
}));
