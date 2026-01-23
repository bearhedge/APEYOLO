# CodeAct Python Sandbox Fix - Embed bridge.py Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix Python code execution in CodeAct agent by embedding bridge.py as a string constant and writing to temp file at runtime.

**Architecture:** The bridge.py file is not deployed to Cloud Run because esbuild only bundles .ts/.js files. We embed the Python code as a TypeScript string constant, write it to a temp file on first execution, and reference that path when spawning Python.

**Tech Stack:** TypeScript, Node.js (fs, os, path, child_process), Python 3

---

### Task 1: Add Imports and Python Bridge String Constant

**Files:**
- Modify: `server/agent/sandbox/executor.ts:1-12`

**Step 1: Read the current executor.ts imports**

Verify current state matches expected structure.

**Step 2: Add fs and os imports, add BRIDGE_CODE constant**

Replace lines 1-12 with:

```typescript
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
```

**Step 3: Commit this change**

```bash
git add server/agent/sandbox/executor.ts
git commit -m "feat(codeact): add embedded Python bridge code constant"
```

---

### Task 2: Add Bridge File Management Functions

**Files:**
- Modify: `server/agent/sandbox/executor.ts` (after BRIDGE_CODE constant, before ExecutionResult interface)

**Step 1: Add module-level state and ensureBridgeFile function**

Insert after the BRIDGE_CODE constant (before the ExecutionResult interface):

```typescript
// Module-level state for bridge file path
let cachedBridgePath: string | null = null;

/**
 * Ensure the Python bridge file exists in temp directory.
 * Creates it on first call, returns cached path on subsequent calls.
 */
function ensureBridgeFile(): string {
  if (cachedBridgePath && fs.existsSync(cachedBridgePath)) {
    return cachedBridgePath;
  }

  const tmpDir = os.tmpdir();
  cachedBridgePath = path.join(tmpDir, 'codeact_bridge.py');
  fs.writeFileSync(cachedBridgePath, BRIDGE_CODE, { mode: 0o755 });
  console.log(`[executor] Bridge file written to: ${cachedBridgePath}`);
  return cachedBridgePath;
}
```

**Step 2: Commit this change**

```bash
git add server/agent/sandbox/executor.ts
git commit -m "feat(codeact): add ensureBridgeFile helper for temp file management"
```

---

### Task 3: Update executePython to Use Temp File

**Files:**
- Modify: `server/agent/sandbox/executor.ts:24-27` (the executePython function start)

**Step 1: Replace the bridgePath calculation**

Change from:

```typescript
export async function executePython(code: string, timeoutMs: number = 30000): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const bridgePath = path.join(__dirname, 'bridge.py');
    const proc = spawn('python3', [bridgePath]);
```

To:

```typescript
export async function executePython(code: string, timeoutMs: number = 30000): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const bridgePath = ensureBridgeFile();
    const proc = spawn('python3', [bridgePath]);
```

**Step 2: Remove unused __dirname imports**

Delete these lines (no longer needed):

```typescript
import { fileURLToPath } from 'url';

// ESM-compatible way to get __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

**Step 3: Commit this change**

```bash
git add server/agent/sandbox/executor.ts
git commit -m "feat(codeact): use temp file bridge instead of __dirname lookup"
```

---

### Task 4: Build and Verify Locally

**Files:**
- None (verification only)

**Step 1: Run the build**

```bash
cd "/Users/home/Desktop/APE YOLO/APE-YOLO"
npm run build
```

Expected: Build succeeds with no errors.

**Step 2: Verify the dist output contains the embedded code**

```bash
grep -l "BRIDGE_CODE" dist/index.js
```

Expected: Shows `dist/index.js` (the string is bundled).

**Step 3: Verify bridge.py is NOT in dist**

```bash
ls dist/bridge.py 2>/dev/null || echo "Good: bridge.py not in dist (expected)"
```

Expected: "Good: bridge.py not in dist (expected)"

---

### Task 5: Deploy to Production

**Files:**
- None (deployment)

**Step 1: Deploy to Cloud Run**

```bash
cd "/Users/home/Desktop/APE YOLO/APE-YOLO"
npm run deploy:prod
```

Expected: Deployment succeeds.

**Step 2: Wait for deployment to complete**

Watch for "Service [apeyolo] revision [apeyolo-XXXXX] has been deployed" message.

---

### Task 6: Verify Fix in Production

**Files:**
- None (verification)

**Step 1: Test the CodeAct wake endpoint**

```bash
curl -X POST https://apeyolo-397870885229.asia-east1.run.app/api/agent/codeact/wake \
  -H "Content-Type: application/json"
```

**Step 2: Analyze the response**

Success criteria:
- No more "Process exited with code 2" error
- Either successful execution OR a different error (like missing `requests` library)

If you see `"error": "Process exited with code 2"` the fix didn't work.
If you see Python execution output or a different error, the fix worked.

**Step 3: Check Cloud Run logs if needed**

```bash
gcloud run services logs read apeyolo --region asia-east1 --limit 50
```

Look for: `[executor] Bridge file written to: /tmp/codeact_bridge.py`

---

## Verification Checklist

- [ ] BRIDGE_CODE constant added to executor.ts
- [ ] ensureBridgeFile function added
- [ ] executePython uses ensureBridgeFile() instead of __dirname
- [ ] Unused fileURLToPath imports removed
- [ ] Build succeeds locally
- [ ] Deploy to production succeeds
- [ ] CodeAct wake endpoint no longer returns "Process exited with code 2"
