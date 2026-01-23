// server/agent/sandbox/executor.ts
// Python sandbox executor for CodeAct agent
// ESM-compatible: uses import.meta.url instead of __dirname

import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM-compatible way to get __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error: string | null;
}

/**
 * Execute Python code in a sandboxed environment.
 * The code has access to a broker object for making HTTP calls to the Node.js server.
 */
export async function executePython(code: string, timeoutMs: number = 30000): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const bridgePath = path.join(__dirname, 'bridge.py');
    const proc = spawn('python3', [bridgePath]);

    let stdout = '';
    let stderr = '';
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill('SIGTERM');
        resolve({
          success: false,
          stdout,
          stderr,
          error: 'Execution timed out'
        });
      }
    }, timeoutMs);

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          success: false,
          stdout,
          stderr,
          error: `Process error: ${err.message}`
        });
      }
    });

    proc.on('close', (exitCode) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);

        try {
          // Parse the JSON output from bridge.py
          const result = JSON.parse(stdout);
          resolve(result);
        } catch {
          // If we can't parse JSON, return raw output
          resolve({
            success: exitCode === 0,
            stdout,
            stderr,
            error: exitCode !== 0 ? `Process exited with code ${exitCode}` : null
          });
        }
      }
    });

    // Write code to stdin and close
    proc.stdin.write(code);
    proc.stdin.end();
  });
}

/**
 * Helper to extract Python code from <python> tags
 */
export function extractPythonCode(text: string): string | null {
  const match = text.match(/<python>([\s\S]*?)<\/python>/);
  return match ? match[1].trim() : null;
}

/**
 * Helper to extract proposal from <proposal> tags
 */
export function extractProposal(text: string): any | null {
  const match = text.match(/<proposal>([\s\S]*?)<\/proposal>/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}
