# Agent Terminal Logging Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a real-time terminal UI at `apeyolo.com/terminal` that displays the CodeAct agent's activity with ape-themed signposts, streaming output, and color-coded formatting.

**Architecture:** SSE streaming from Cloud Run to browser, enhanced AgentLogger with start/append pattern for continuous blocks, React terminal component with monospace styling.

**Tech Stack:** TypeScript, React, Server-Sent Events, CSS color classes

---

## Log Types

| Type | Label | Color | Hex | Purpose |
|------|-------|-------|-----|---------|
| `BANANA_TIME` | BANANA TIME | Green | #4ade80 | Session starting, waking up |
| `APE_BRAIN` | APE BRAIN | Cyan | #22d3ee | AI thinking/reasoning stream |
| `GRABBING_DATA` | GRABBING DATA | Yellow | #facc15 | Executing Python code |
| `FOUND_BANANA` | FOUND BANANA | White | #f5f5f5 | Data received/output |
| `SWING_TIME` | SWING TIME | Magenta | #e879f9 | Proposing a trade (market hours) |
| `NO_SWING` | NO SWING | Gray | #9ca3af | Decided not to trade |
| `BAD_BANANA` | BAD BANANA | Red | #f87171 | Error occurred |
| `DANGER_BRANCH` | DANGER BRANCH | Orange | #fb923c | Warning (stop loss, risk) |
| `BACK_TO_TREE` | BACK TO TREE | Green | #4ade80 | Session complete, sleeping |

---

## Output Format

```
09:28:39 [BANANA TIME]     Session started (off_hours)
09:28:41 [APE BRAIN]       Okay so I'm checking the market right now... It's
                           9:28 AM ET, outside trading hours. Let me grab SPY
                           and VIX prices to see what's happening. I should
                           also check the account and positions.
09:28:45 [GRABBING DATA]   Executing code...
                           spy = broker.get_price("SPY")
                           vix = broker.get_price("VIX")
                           account = broker.get_account()
                           print(f"SPY: {spy}, VIX: {vix}")
09:28:47 [FOUND BANANA]    SPY: 687.34, VIX: 16.04
                           Account: $104,797.57
                           Positions: none
09:28:49 [APE BRAIN]       SPY at 687.34, VIX at 16.04 indicates low volatility.
                           Market is calm, no unusual activity.
09:28:51 [NO SWING]        Off hours - just observing, no trade proposal
09:28:51 [BACK TO TREE]    Session complete
```

### Format Rules

1. **Timestamp** on every new log block (dimmed gray #6b7280)
2. **Tag** appears once per block, content flows/wraps beneath
3. **Indentation** aligns continuation lines with the content start
4. **Code blocks** are indented beneath the GRABBING DATA tag
5. **Real-time streaming** - text appears character by character as AI generates

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CLOUD RUN (Server)                      │
│                                                             │
│  DeepSeek streams tokens ──► AgentLogger formats them       │
│                                    │                        │
│                                    ▼                        │
│                              SSE EventStream                │
│                                    │                        │
└────────────────────────────────────│────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   BROWSER (apeyolo.com/terminal)            │
│                                                             │
│  EventSource listens ──► Appends to terminal <div>          │
│                          with colors + formatting           │
└─────────────────────────────────────────────────────────────┘
```

---

## Logger Implementation

### Log Type Configuration

```typescript
// server/agent/logger.ts

export const LOG_TYPES = {
  BANANA_TIME:    { label: 'BANANA TIME',    color: 'green' },
  APE_BRAIN:      { label: 'APE BRAIN',      color: 'cyan' },
  GRABBING_DATA:  { label: 'GRABBING DATA',  color: 'yellow' },
  FOUND_BANANA:   { label: 'FOUND BANANA',   color: 'white' },
  SWING_TIME:     { label: 'SWING TIME',     color: 'magenta' },
  NO_SWING:       { label: 'NO SWING',       color: 'gray' },
  BAD_BANANA:     { label: 'BAD BANANA',     color: 'red' },
  DANGER_BRANCH:  { label: 'DANGER BRANCH',  color: 'orange' },
  BACK_TO_TREE:   { label: 'BACK TO TREE',   color: 'green' },
} as const;

export type LogType = keyof typeof LOG_TYPES;
```

### Streaming Pattern

```typescript
// Two modes for streaming:
// 1. "start" - begins a new log block (shows timestamp + tag)
// 2. "append" - adds text to current block (no new tag)

interface LogEvent {
  type: 'start' | 'append';
  logType?: LogType;      // required for 'start'
  text: string;
  timestamp?: string;     // required for 'start'
}

class AgentLogger {
  start(type: LogType, text: string): void {
    // Emits: { type: 'start', logType: type, text, timestamp }
  }

  append(text: string): void {
    // Emits: { type: 'append', text }
  }
}
```

### SSE Endpoint

```typescript
// server/agentRoutes.ts

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const onLog = (event: LogEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  agentEvents.on('log', onLog);

  req.on('close', () => {
    agentEvents.off('log', onLog);
  });
});
```

---

## Terminal UI Component

### Styling

```css
/* src/styles/terminal.css */

.agent-terminal {
  background: #0d1117;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 14px;
  line-height: 1.5;
  padding: 16px;
  height: 100%;
  overflow-y: auto;
}

.log-line {
  white-space: pre-wrap;
  word-break: break-word;
}

.timestamp {
  color: #6b7280;
}

.log-tag {
  font-weight: bold;
}

/* Log type colors */
.log-banana-time    { color: #4ade80; }
.log-ape-brain      { color: #22d3ee; }
.log-grabbing-data  { color: #facc15; }
.log-found-banana   { color: #f5f5f5; }
.log-swing-time     { color: #e879f9; }
.log-no-swing       { color: #9ca3af; }
.log-bad-banana     { color: #f87171; }
.log-danger-branch  { color: #fb923c; }
.log-back-to-tree   { color: #4ade80; }
```

### React Component

```tsx
// src/pages/Terminal.tsx

function AgentTerminal() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const eventSource = new EventSource('/api/agent/stream');

    eventSource.onmessage = (e) => {
      const event: LogEvent = JSON.parse(e.data);

      if (event.type === 'start') {
        // Add new line
        setLines(prev => [...prev, {
          timestamp: event.timestamp,
          logType: event.logType,
          text: event.text,
        }]);
      } else {
        // Append to last line
        setLines(prev => {
          const updated = [...prev];
          updated[updated.length - 1].text += event.text;
          return updated;
        });
      }
    };

    return () => eventSource.close();
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    terminalRef.current?.scrollTo(0, terminalRef.current.scrollHeight);
  }, [lines]);

  return (
    <div className="agent-terminal" ref={terminalRef}>
      {lines.map((line, i) => (
        <div key={i} className="log-line">
          <span className="timestamp">{line.timestamp}</span>
          {' '}
          <span className={`log-tag log-${line.logType.toLowerCase().replace('_', '-')}`}>
            [{LOG_TYPES[line.logType].label}]
          </span>
          {'     '}
          <span className={`log-${line.logType.toLowerCase().replace('_', '-')}`}>
            {line.text}
          </span>
        </div>
      ))}
    </div>
  );
}
```

---

## Orchestrator Integration

Update the orchestrator to use the new logger:

```typescript
// server/agent/codeact/orchestrator.ts

async run(trigger) {
  logger.start('BANANA_TIME', `Session started (${this.mode})`);

  // ... thinking loop
  logger.start('APE_BRAIN', '');  // Start thinking block

  // DeepSeek streams thinking - each chunk calls:
  logger.append(chunk);  // Streams into APE_BRAIN block

  // Code execution
  if (code) {
    logger.start('GRABBING_DATA', 'Executing code...\n' + code);
    const result = await executePython(code);

    if (result.success) {
      logger.start('FOUND_BANANA', result.stdout);
    } else {
      logger.start('BAD_BANANA', result.error || result.stderr);
    }
  }

  // Decision
  if (proposal) {
    logger.start('SWING_TIME', `Proposing: ${proposal.action}`);
  } else if (this.mode === 'off_hours') {
    logger.start('NO_SWING', 'Off hours - just observing');
  }

  logger.start('BACK_TO_TREE', 'Session complete');
}
```

---

## Design Principles

1. **Personality in the frame, clarity in the content** - Ape-themed tags, technical AI reasoning
2. **Real-time streaming** - See thinking unfold live, not after the fact
3. **One tag per block** - Content flows beneath, no repeated prefixes
4. **Extensible** - Easy to add new log types as agent capabilities grow
5. **Timestamp everything** - Trading context requires knowing when things happened

---

## Future Considerations

- Session history / replay
- Filter by log type
- Search within logs
- Export logs
- Multiple concurrent sessions
- Mobile-responsive terminal view
