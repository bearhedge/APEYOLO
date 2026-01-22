/**
 * Extract JSON from LLM response, handling:
 * - <think>...</think> tags (DeepSeek R1)
 * - Markdown code blocks (```json)
 * - Trailing text after JSON
 */
export function extractJSON<T>(content: string): { json: T | null; thinking: string; error?: string } {
  // 1. Extract thinking from <think> tags
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  const thinking = thinkMatch ? thinkMatch[1].trim() : '';

  // 2. Remove thinking tags
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // 3. Strip markdown code blocks (```json or ```)
  cleaned = cleaned.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();

  // 4. Find JSON using brace counting (not greedy regex)
  const startIdx = cleaned.indexOf('{');
  if (startIdx === -1) {
    return { json: null, thinking, error: 'No JSON object found' };
  }

  let depth = 0;
  let endIdx = -1;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < cleaned.length; i++) {
    const char = cleaned[i];

    // Handle escape sequences inside strings
    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    // Toggle string mode on quotes
    if (char === '"') {
      inString = !inString;
      continue;
    }

    // Only count braces outside strings
    if (!inString) {
      if (char === '{') depth++;
      else if (char === '}') depth--;

      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }

  if (endIdx === -1) {
    return { json: null, thinking, error: 'Incomplete JSON (unmatched braces)' };
  }

  // 5. Parse the extracted JSON
  try {
    const jsonStr = cleaned.substring(startIdx, endIdx + 1);
    const json = JSON.parse(jsonStr) as T;
    return { json, thinking };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { json: null, thinking, error: `JSON.parse failed: ${msg}` };
  }
}
