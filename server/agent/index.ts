// APE Agent - Autonomous Trading Agent
// Exports for integration with the main server

export { agent } from './autonomous';
export { logger, agentEvents, type LogEntry, type LogType } from './logger';
export { memory } from './memory';
export {
  startAutonomousAgent,
  stopAutonomousAgent,
  isSchedulerRunning,
  triggerManualWakeUp,
  getSchedulerStatus,
} from './scheduler';
export type {
  AgentContext,
  Observation,
  TriageResult,
  Decision,
  TradeParams,
} from './types';
