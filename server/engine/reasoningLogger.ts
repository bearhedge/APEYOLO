/**
 * Reasoning Logger - Transparent Step-by-Step Engine Reasoning
 *
 * This module provides a structured way to capture and display the engine's
 * reasoning process at each step. The goal is transparency - no black box.
 *
 * Each step produces a reasoning chain that shows:
 * - What data was used (inputs)
 * - What logic was applied (reasoning steps)
 * - What calculations were performed (computations)
 * - What decision was made (decision)
 * - How confident we are (confidence)
 */

// =============================================================================
// Types
// =============================================================================

/**
 * A single computation performed during reasoning
 */
export interface Computation {
  name: string;                        // e.g., "VIX Threshold Check"
  formula: string;                     // e.g., "VIX < threshold"
  values: Record<string, number | string | boolean>;  // e.g., { VIX: 16.35, threshold: 20 }
  result: boolean | number | string;   // e.g., true
  explain?: string;                    // Optional human explanation
}

/**
 * A single reasoning step within a step's logic
 */
export interface LogicStep {
  index: number;                       // 1, 2, 3...
  action: string;                      // What was done
  result?: string;                     // What was the outcome
  warning?: string;                    // Any concerns
}

/**
 * Complete reasoning for one engine step
 */
export interface StepReasoning {
  step: 1 | 2 | 3 | 4 | 5;
  name: string;
  timestamp: string;

  // What data was used
  inputs: Record<string, unknown>;

  // Step-by-step reasoning (human-readable)
  logic: LogicStep[];

  // Actual calculations with formulas
  computations: Computation[];

  // Final decision for this step
  decision: string;
  decisionEmoji: string;               // Visual indicator

  // Confidence and gating
  confidence: number;                  // 0-100%
  canProceed: boolean;                 // Gate to next step

  // Any concerns
  warnings: string[];

  // Additional context
  metadata?: Record<string, unknown>;
}

/**
 * Extended audit entry that includes full reasoning
 */
export interface ReasoningAuditEntry {
  step: number;
  name: string;
  timestamp: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  passed: boolean;
  reason?: string;

  // NEW: Full reasoning chain
  reasoning: StepReasoning;
}

// =============================================================================
// Reasoning Builder
// =============================================================================

/**
 * Builder class for constructing step reasoning
 */
export class ReasoningBuilder {
  private step: 1 | 2 | 3 | 4 | 5;
  private name: string;
  private inputs: Record<string, unknown> = {};
  private logic: LogicStep[] = [];
  private computations: Computation[] = [];
  private warnings: string[] = [];
  private metadata: Record<string, unknown> = {};
  private logIndex = 0;

  constructor(step: 1 | 2 | 3 | 4 | 5, name: string) {
    this.step = step;
    this.name = name;
  }

  /**
   * Add input data that was used
   */
  addInput(key: string, value: unknown): this {
    this.inputs[key] = value;
    return this;
  }

  /**
   * Add multiple inputs at once
   */
  addInputs(inputs: Record<string, unknown>): this {
    Object.assign(this.inputs, inputs);
    return this;
  }

  /**
   * Add a logic step (reasoning)
   */
  addLogicStep(action: string, result?: string): this {
    this.logIndex++;
    this.logic.push({
      index: this.logIndex,
      action,
      result,
    });
    return this;
  }

  /**
   * Add a logic step with a warning
   */
  addLogicStepWithWarning(action: string, warning: string): this {
    this.logIndex++;
    this.logic.push({
      index: this.logIndex,
      action,
      warning,
    });
    this.warnings.push(warning);
    return this;
  }

  /**
   * Add a computation (calculation)
   */
  addComputation(
    name: string,
    formula: string,
    values: Record<string, number | string | boolean>,
    result: boolean | number | string,
    explain?: string
  ): this {
    this.computations.push({ name, formula, values, result, explain });
    return this;
  }

  /**
   * Add a warning
   */
  addWarning(warning: string): this {
    this.warnings.push(warning);
    return this;
  }

  /**
   * Add metadata
   */
  addMetadata(key: string, value: unknown): this {
    this.metadata[key] = value;
    return this;
  }

  /**
   * Build the final StepReasoning
   */
  build(
    decision: string,
    decisionEmoji: string,
    confidence: number,
    canProceed: boolean
  ): StepReasoning {
    return {
      step: this.step,
      name: this.name,
      timestamp: new Date().toISOString(),
      inputs: this.inputs,
      logic: this.logic,
      computations: this.computations,
      decision,
      decisionEmoji,
      confidence: Math.round(confidence * 100) / 100, // Round to 2 decimals
      canProceed,
      warnings: this.warnings,
      metadata: Object.keys(this.metadata).length > 0 ? this.metadata : undefined,
    };
  }
}

// =============================================================================
// Reasoning Aggregator
// =============================================================================

/**
 * Aggregates reasoning across all 5 steps
 */
export class ReasoningAggregator {
  private steps: StepReasoning[] = [];
  private startTime: Date;

  constructor() {
    this.startTime = new Date();
  }

  /**
   * Add a step's reasoning
   */
  addStep(reasoning: StepReasoning): void {
    this.steps.push(reasoning);
  }

  /**
   * Get all steps
   */
  getSteps(): StepReasoning[] {
    return this.steps;
  }

  /**
   * Get step by number
   */
  getStep(stepNumber: 1 | 2 | 3 | 4 | 5): StepReasoning | undefined {
    return this.steps.find(s => s.step === stepNumber);
  }

  /**
   * Convert to audit entries for API response
   */
  toAuditEntries(): ReasoningAuditEntry[] {
    return this.steps.map(reasoning => ({
      step: reasoning.step,
      name: reasoning.name,
      timestamp: reasoning.timestamp,
      input: reasoning.inputs as Record<string, unknown>,
      output: {
        decision: reasoning.decision,
        confidence: reasoning.confidence,
        canProceed: reasoning.canProceed,
        computationsCount: reasoning.computations.length,
        warningsCount: reasoning.warnings.length,
      },
      passed: reasoning.canProceed,
      reason: reasoning.decision,
      reasoning,
    }));
  }

  /**
   * Get overall summary
   */
  getSummary(): {
    totalSteps: number;
    passedSteps: number;
    totalWarnings: number;
    totalComputations: number;
    averageConfidence: number;
    canExecute: boolean;
    failedAtStep?: number;
    elapsedMs: number;
  } {
    const passedSteps = this.steps.filter(s => s.canProceed).length;
    const failedStep = this.steps.find(s => !s.canProceed);

    return {
      totalSteps: this.steps.length,
      passedSteps,
      totalWarnings: this.steps.reduce((sum, s) => sum + s.warnings.length, 0),
      totalComputations: this.steps.reduce((sum, s) => sum + s.computations.length, 0),
      averageConfidence:
        this.steps.length > 0
          ? this.steps.reduce((sum, s) => sum + s.confidence, 0) / this.steps.length
          : 0,
      canExecute: passedSteps === this.steps.length,
      failedAtStep: failedStep?.step,
      elapsedMs: Date.now() - this.startTime.getTime(),
    };
  }

  /**
   * Format reasoning as human-readable string (for console/logs)
   */
  formatAsText(): string {
    const lines: string[] = [];

    lines.push('=' .repeat(60));
    lines.push('ENGINE REASONING CHAIN');
    lines.push('=' .repeat(60));

    for (const step of this.steps) {
      lines.push('');
      lines.push(`Step ${step.step}: ${step.name}`);
      lines.push('-'.repeat(40));

      // Inputs
      lines.push('Inputs:');
      for (const [key, value] of Object.entries(step.inputs)) {
        const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        lines.push(`  - ${key}: ${displayValue}`);
      }

      // Logic steps
      lines.push('');
      lines.push('Logic:');
      for (const logic of step.logic) {
        let line = `  ${logic.index}. ${logic.action}`;
        if (logic.result) line += ` => ${logic.result}`;
        if (logic.warning) line += ` [WARNING: ${logic.warning}]`;
        lines.push(line);
      }

      // Computations
      if (step.computations.length > 0) {
        lines.push('');
        lines.push('Computations:');
        for (const comp of step.computations) {
          const valuesStr = Object.entries(comp.values)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
          lines.push(`  - ${comp.name}: ${comp.formula}`);
          lines.push(`    Values: ${valuesStr}`);
          lines.push(`    Result: ${comp.result}`);
          if (comp.explain) lines.push(`    Explanation: ${comp.explain}`);
        }
      }

      // Decision
      lines.push('');
      lines.push(`Decision: ${step.decisionEmoji} ${step.decision}`);
      lines.push(`Confidence: ${step.confidence}%`);
      lines.push(`Can Proceed: ${step.canProceed ? 'YES' : 'NO'}`);

      // Warnings
      if (step.warnings.length > 0) {
        lines.push('');
        lines.push('Warnings:');
        for (const warning of step.warnings) {
          lines.push(`  ! ${warning}`);
        }
      }
    }

    // Summary
    const summary = this.getSummary();
    lines.push('');
    lines.push('=' .repeat(60));
    lines.push('SUMMARY');
    lines.push('=' .repeat(60));
    lines.push(`Steps: ${summary.passedSteps}/${summary.totalSteps} passed`);
    lines.push(`Warnings: ${summary.totalWarnings}`);
    lines.push(`Computations: ${summary.totalComputations}`);
    lines.push(`Avg Confidence: ${summary.averageConfidence.toFixed(1)}%`);
    lines.push(`Elapsed: ${summary.elapsedMs}ms`);
    lines.push(`Can Execute: ${summary.canExecute ? 'YES' : 'NO'}`);
    if (summary.failedAtStep) {
      lines.push(`Failed at Step: ${summary.failedAtStep}`);
    }

    return lines.join('\n');
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a new reasoning builder for a step
 */
export function createReasoning(step: 1 | 2 | 3 | 4 | 5, name: string): ReasoningBuilder {
  return new ReasoningBuilder(step, name);
}

/**
 * Create a new reasoning aggregator
 */
export function createAggregator(): ReasoningAggregator {
  return new ReasoningAggregator();
}

/**
 * Format a number for display (with commas and decimals)
 */
export function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a percentage for display
 */
export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format a currency amount for display
 */
export function formatCurrency(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
