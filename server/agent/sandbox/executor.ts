// server/agent/sandbox/executor.ts
// Python sandbox executor for CodeAct agent
// Embeds bridge.py as string constant for deployment compatibility

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Python bridge code embedded as string constant
// This gets written to a temp file at runtime since esbuild doesn't bundle .py files
const BRIDGE_CODE = `#!/usr/bin/env python3
"""
bridge.py - Python sandbox bridge for CodeAct agent

Executes code from DeepSeek and provides access to broker via HTTP calls.
Used by the Node.js executor to run Python code in a controlled environment.
"""
import sys
import json
import io
from contextlib import redirect_stdout, redirect_stderr

# Try to import requests, provide fallback for environments without it
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

# Broker API base URL - calls back to the Node.js server via internal routes
BROKER_URL = "http://localhost:3000/api/agent/internal/broker"


class Broker:
    """HTTP bridge to Node.js broker API"""

    def __init__(self):
        if not REQUESTS_AVAILABLE:
            print("[Warning] requests library not available - broker calls will fail", file=sys.stderr)

    def get_price(self, symbol: str) -> float:
        """Get current price for a symbol"""
        if not REQUESTS_AVAILABLE:
            return 0.0
        try:
            resp = requests.get(f"{BROKER_URL}/market-data/{symbol}", timeout=10)
            data = resp.json()
            return data.get('price', 0.0)
        except Exception as e:
            print(f"[Broker] get_price error: {e}", file=sys.stderr)
            return 0.0

    def get_account(self) -> dict:
        """Get account info"""
        if not REQUESTS_AVAILABLE:
            return {}
        try:
            resp = requests.get(f"{BROKER_URL}/account", timeout=10)
            return resp.json()
        except Exception as e:
            print(f"[Broker] get_account error: {e}", file=sys.stderr)
            return {}

    def get_positions(self) -> list:
        """Get open positions"""
        if not REQUESTS_AVAILABLE:
            return []
        try:
            resp = requests.get(f"{BROKER_URL}/positions", timeout=10)
            return resp.json()
        except Exception as e:
            print(f"[Broker] get_positions error: {e}", file=sys.stderr)
            return []

    def get_option_chain(self, symbol: str) -> dict:
        """Get option chain for symbol"""
        if not REQUESTS_AVAILABLE:
            return {}
        try:
            resp = requests.get(f"{BROKER_URL}/options/{symbol}", timeout=10)
            return resp.json()
        except Exception as e:
            print(f"[Broker] get_option_chain error: {e}", file=sys.stderr)
            return {}


# Global broker instance for agent code
broker = Broker()


def execute_code(code: str) -> dict:
    """Execute agent code and capture output"""
    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()
    result = {"success": True, "stdout": "", "stderr": "", "error": None}

    try:
        # Execute with broker in the global namespace
        with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
            exec(code, {"broker": broker, "print": print, "__builtins__": __builtins__})
        result["stdout"] = stdout_capture.getvalue()
        result["stderr"] = stderr_capture.getvalue()
    except Exception as e:
        result["success"] = False
        result["error"] = str(e)
        result["stdout"] = stdout_capture.getvalue()
        result["stderr"] = stderr_capture.getvalue()

    return result


if __name__ == "__main__":
    # Read code from stdin
    code = sys.stdin.read()
    result = execute_code(code)
    # Output JSON result to stdout
    print(json.dumps(result))
`;

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
