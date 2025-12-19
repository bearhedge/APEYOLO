/**
 * Knowledge Module
 *
 * CRUD operations for the agent's learning system:
 * - Patterns: Market conditions and their outcomes
 * - Lessons: Trader insights and agent learnings
 * - Ticks: Log of every autonomous tick
 */

import { db, isDatabaseConfigured } from '../db';
import { patterns, lessons, agentTicks, trades } from '@shared/schema';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import type { Pattern, Lesson, AgentTick, InsertPattern, InsertLesson, InsertAgentTick } from '@shared/schema';

/**
 * Ensure database is available
 */
function requireDb() {
  if (!db) {
    throw new Error('Database not configured - set DATABASE_URL environment variable');
  }
  return db;
}

// =============================================================================
// PATTERNS
// =============================================================================

interface PatternConditions {
  vixMin?: number;
  vixMax?: number;
  timeStart?: string;  // "10:00" format
  timeEnd?: string;
}

/**
 * Get patterns that match current market conditions
 */
export async function getRelevantPatterns(
  vix: number,
  currentTime: string  // "HH:MM" format
): Promise<Pattern[]> {
  const database = requireDb();
  const activePatterns = await database
    .select()
    .from(patterns)
    .where(eq(patterns.isActive, true));

  // Filter patterns by conditions
  return activePatterns.filter(pattern => {
    const conditions = pattern.conditions as PatternConditions | null;
    if (!conditions) return true; // No conditions = always relevant

    // Check VIX range
    if (conditions.vixMin !== undefined && vix < conditions.vixMin) return false;
    if (conditions.vixMax !== undefined && vix > conditions.vixMax) return false;

    // Check time range
    if (conditions.timeStart && currentTime < conditions.timeStart) return false;
    if (conditions.timeEnd && currentTime > conditions.timeEnd) return false;

    return true;
  });
}

/**
 * Get all active patterns
 */
export async function getAllPatterns(): Promise<Pattern[]> {
  const database = requireDb();
  return database
    .select()
    .from(patterns)
    .where(eq(patterns.isActive, true))
    .orderBy(desc(patterns.trades));
}

/**
 * Create a new pattern
 */
export async function createPattern(pattern: InsertPattern): Promise<Pattern> {
  const database = requireDb();
  const [created] = await database
    .insert(patterns)
    .values(pattern)
    .returning();
  return created;
}

/**
 * Update pattern statistics after a trade outcome
 */
export async function updatePatternStats(
  patternId: string,
  win: boolean,
  pnl: number
): Promise<void> {
  const database = requireDb();
  const [pattern] = await database
    .select()
    .from(patterns)
    .where(eq(patterns.id, patternId));

  if (!pattern) return;

  const currentPnl = parseFloat(pattern.totalPnl || '0');

  await database
    .update(patterns)
    .set({
      trades: pattern.trades + 1,
      wins: win ? pattern.wins + 1 : pattern.wins,
      totalPnl: (currentPnl + pnl).toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(patterns.id, patternId));
}

/**
 * Deactivate a pattern
 */
export async function deactivatePattern(patternId: string): Promise<void> {
  const database = requireDb();
  await database
    .update(patterns)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(patterns.id, patternId));
}

// =============================================================================
// LESSONS
// =============================================================================

/**
 * Get all active lessons
 */
export async function getActiveLessons(): Promise<Lesson[]> {
  const database = requireDb();
  return database
    .select()
    .from(lessons)
    .where(eq(lessons.isActive, true))
    .orderBy(desc(lessons.createdAt));
}

/**
 * Get lessons by category
 */
export async function getLessonsByCategory(category: string): Promise<Lesson[]> {
  const database = requireDb();
  return database
    .select()
    .from(lessons)
    .where(and(
      eq(lessons.isActive, true),
      eq(lessons.category, category)
    ))
    .orderBy(desc(lessons.createdAt));
}

/**
 * Add a new lesson
 */
export async function addLesson(
  content: string,
  source: 'trader' | 'analysis',
  category?: string
): Promise<Lesson> {
  const database = requireDb();
  const [created] = await database
    .insert(lessons)
    .values({
      content,
      source,
      category,
    })
    .returning();
  return created;
}

/**
 * Deactivate a lesson
 */
export async function deactivateLesson(lessonId: string): Promise<void> {
  const database = requireDb();
  await database
    .update(lessons)
    .set({ isActive: false })
    .where(eq(lessons.id, lessonId));
}

// =============================================================================
// AGENT TICKS
// =============================================================================

/**
 * Record an agent tick
 */
export async function recordTick(tick: InsertAgentTick): Promise<AgentTick> {
  const database = requireDb();
  const [created] = await database
    .insert(agentTicks)
    .values(tick)
    .returning();
  return created;
}

/**
 * Get recent ticks
 */
export async function getRecentTicks(limit: number = 50): Promise<AgentTick[]> {
  const database = requireDb();
  return database
    .select()
    .from(agentTicks)
    .orderBy(desc(agentTicks.tickTime))
    .limit(limit);
}

/**
 * Get ticks for a specific day
 */
export async function getTicksForDay(date: Date): Promise<AgentTick[]> {
  const database = requireDb();
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return database
    .select()
    .from(agentTicks)
    .where(and(
      gte(agentTicks.tickTime, startOfDay),
      lte(agentTicks.tickTime, endOfDay)
    ))
    .orderBy(agentTicks.tickTime);
}

/**
 * Get tick statistics for a day
 */
export async function getTickStats(date: Date): Promise<{
  total: number;
  decisions: Record<string, number>;
  avgDurationMs: number;
}> {
  const ticks = await getTicksForDay(date);

  const decisions: Record<string, number> = {};
  let totalDuration = 0;
  let durationCount = 0;

  for (const tick of ticks) {
    decisions[tick.decision] = (decisions[tick.decision] || 0) + 1;
    if (tick.durationMs) {
      totalDuration += tick.durationMs;
      durationCount++;
    }
  }

  return {
    total: ticks.length,
    decisions,
    avgDurationMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
  };
}

// =============================================================================
// KNOWLEDGE AGGREGATION
// =============================================================================

/**
 * Load all knowledge for LLM context
 * Returns a structured summary for the agent to use in decisions
 */
export async function loadKnowledge(vix: number, currentTime: string): Promise<{
  patterns: Pattern[];
  lessons: Lesson[];
  summary: string;
}> {
  const [relevantPatterns, activeLessons] = await Promise.all([
    getRelevantPatterns(vix, currentTime),
    getActiveLessons(),
  ]);

  // Build summary string for LLM context
  const patternSummary = relevantPatterns.length > 0
    ? relevantPatterns.map(p => {
        const winRate = p.trades > 0 ? ((p.wins / p.trades) * 100).toFixed(0) : '0';
        return `- ${p.name}: ${p.recommendation} (${p.trades} trades, ${winRate}% win rate, $${p.totalPnl} P&L)`;
      }).join('\n')
    : 'No matching patterns found.';

  const lessonSummary = activeLessons.length > 0
    ? activeLessons.map(l => `- [${l.source}] ${l.content}`).join('\n')
    : 'No lessons recorded yet.';

  const summary = `
## Relevant Patterns (VIX: ${vix.toFixed(1)}, Time: ${currentTime})
${patternSummary}

## Active Lessons
${lessonSummary}
`.trim();

  return {
    patterns: relevantPatterns,
    lessons: activeLessons,
    summary,
  };
}

/**
 * Record trade outcome and update related pattern
 */
export async function recordTradeOutcome(
  tradeId: string,
  patternId: string | null,
  win: boolean,
  pnl: number
): Promise<void> {
  const database = requireDb();
  // Update the trade record
  await database
    .update(trades)
    .set({ patternId })
    .where(eq(trades.id, tradeId));

  // Update pattern statistics if linked
  if (patternId) {
    await updatePatternStats(patternId, win, pnl);
  }
}
