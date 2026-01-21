/**
 * Orchestrator - Runs the LLM conversation loop with tool calling
 *
 * The orchestrator sends context to the LLM, receives tool calls,
 * executes them, and returns results until the LLM says "done".
 */

import { logger, LogType } from '../logger';
import { toolkit, resetToolkitState } from '../toolkit';
import { ORCHESTRATOR_SYSTEM_PROMPT, buildContextMessage } from './orchestratorPrompt';
import type { LLMResponse, OrchestratorResult, ToolName } from '../toolkit/types';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const MAX_TOOL_CALLS = 15; // Safety limit

export class AgentOrchestrator {
  private baseUrl = 'https://nonperversive-dianne-sketchily.ngrok-free.dev'; // Ollama via ngrok
  private sessionId: string;
  private messages: ChatMessage[] = [];
  private toolCallCount = 0;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Run the orchestration loop
   */
  async run(context: {
    time: string;
    tradesToday: number;
    dailyPnl: number;
    hasPosition: boolean;
  }): Promise<OrchestratorResult> {
    // Reset toolkit state for fresh run
    resetToolkitState();
    this.toolCallCount = 0;

    // Initialize conversation
    this.messages = [
      { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
      { role: 'user', content: buildContextMessage(context) },
    ];

    this.log('TOOLKIT', 'Starting orchestration loop...');

    try {
      while (this.toolCallCount < MAX_TOOL_CALLS) {
        // Get LLM response
        const response = await this.callLLM();

        // Parse the response
        const parsed = this.parseResponse(response);

        if (!parsed) {
          this.log('ERROR', 'Failed to parse LLM response');
          return {
            success: false,
            traded: false,
            summary: 'Failed to parse LLM response',
            toolCallCount: this.toolCallCount,
            error: 'Parse error',
          };
        }

        // Log thinking
        if (parsed.thinking) {
          this.log('THINK', `[R1] ${parsed.thinking.substring(0, 300)}${parsed.thinking.length > 300 ? '...' : ''}`);
        }

        // Check if done
        if (parsed.action === 'done') {
          const decision = parsed.final_decision;
          this.log('DECIDE', decision.summary);

          return {
            success: true,
            traded: decision.traded,
            summary: decision.summary,
            toolCallCount: this.toolCallCount,
          };
        }

        // Execute tool call
        if (parsed.action === 'call_tool' && parsed.tool) {
          const result = await this.executeTool(parsed.tool as ToolName, parsed.params ?? {});

          // Add assistant response and tool result to conversation
          this.messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
          this.messages.push({ role: 'user', content: `Tool result:\n${JSON.stringify(result, null, 2)}` });

          this.toolCallCount++;
        }
      }

      // Hit max tool calls
      this.log('ERROR', `Max tool calls (${MAX_TOOL_CALLS}) reached`);
      return {
        success: false,
        traded: false,
        summary: 'Max tool calls reached',
        toolCallCount: this.toolCallCount,
        error: 'Max iterations',
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log('ERROR', `Orchestrator error: ${message}`);
      return {
        success: false,
        traded: false,
        summary: `Error: ${message}`,
        toolCallCount: this.toolCallCount,
        error: message,
      };
    }
  }

  /**
   * Call the LLM and get response
   */
  private async callLLM(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-r1:70b',
        messages: this.messages,
        temperature: 0.2,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  /**
   * Parse LLM response, handling <think> tags
   */
  private parseResponse(content: string): LLMResponse | null {
    try {
      // Extract <think>...</think> if present
      const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
      const thinking = thinkMatch ? thinkMatch[1].trim() : '';

      // Remove thinking tags to get JSON
      const jsonContent = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

      // Extract JSON
      const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Add extracted thinking if not in JSON
      if (!parsed.thinking && thinking) {
        parsed.thinking = thinking;
      }

      return parsed as LLMResponse;
    } catch {
      return null;
    }
  }

  /**
   * Execute a tool and return result
   */
  private async executeTool(toolName: ToolName, params: Record<string, unknown>): Promise<unknown> {
    this.log('TOOLKIT', `${toolName}(${JSON.stringify(params)})`);

    const toolFn = toolkit[toolName];
    if (!toolFn) {
      return { error: `Unknown tool: ${toolName}` };
    }

    try {
      const result = await (toolFn as (params: Record<string, unknown>) => Promise<unknown>)(params);

      // Log summarized result
      const summary = this.summarizeResult(toolName, result);
      this.log('TOOLKIT', `${toolName} -> ${summary}`);

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log('ERROR', `${toolName} failed: ${message}`);
      return { error: message };
    }
  }

  /**
   * Summarize tool result for logging
   */
  private summarizeResult(toolName: string, result: unknown): string {
    const r = result as Record<string, unknown>;

    switch (toolName) {
      case 'check_market':
        return `VIX=${r.vix}, SPY=$${r.spyPrice}, window=${r.isTradingWindow ? 'OPEN' : 'CLOSED'}`;
      case 'analyze_direction':
        return `${r.direction} (${Math.round((r.confidence as number) * 100)}% conf, ${r.trend} trend)`;
      case 'get_strikes': {
        const rec = r.recommended as Record<string, unknown> | null;
        return rec ? `$${rec.strike} @ d${rec.delta} ($${rec.premium})` : 'No strikes found';
      }
      case 'calculate_size':
        return `${r.contracts} contracts, $${r.totalMargin} margin, ${(r.maxLossPercent as number).toFixed(1)}% risk`;
      case 'get_exit_rules':
        return `stop=$${r.stopLossPrice}, time=${r.timeStop}`;
      case 'execute_trade':
        return `${r.status}: ${r.message}`;
      case 'check_position':
        return r.hasPosition ? `P&L: $${(r.position as Record<string, unknown>)?.pnl}` : 'No position';
      default:
        return JSON.stringify(result).substring(0, 100);
    }
  }

  /**
   * Log to Activity Log
   */
  private log(type: LogType, message: string): void {
    logger.log({ sessionId: this.sessionId, type, message });
  }
}
