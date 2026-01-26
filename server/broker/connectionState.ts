/**
 * IBKR Connection State Machine
 *
 * Single source of truth for IBKR connection status.
 * Separates auth state from data flow to prevent oscillation.
 *
 * State transitions:
 *   DISCONNECTED → AUTHENTICATING: OAuth flow started
 *   AUTHENTICATING → CONNECTED: All 4 auth steps complete
 *   CONNECTED → STREAMING: First SPY data received
 *   STREAMING → STALE: No data for 30 minutes
 *   STALE → STREAMING: Data resumes
 *   Any → ERROR: Auth fails or WebSocket disconnects unexpectedly
 *   Any → DISCONNECTED: Explicit logout or connection close
 */

export type ConnectionPhase =
  | 'disconnected'    // Not connected, no auth attempted
  | 'authenticating'  // Auth in progress
  | 'connected'       // Auth complete, waiting for data
  | 'streaming'       // Auth complete + receiving data
  | 'stale'           // Auth complete but no data for 30+ minutes
  | 'error';          // Auth or connection failure

export interface AuthStepStatus {
  success: boolean;
  timestamp: Date | null;
  error?: string;
}

export interface ConnectionState {
  // Overall computed phase
  phase: ConnectionPhase;

  // Auth steps - persist once successful until explicit logout
  auth: {
    oauth: AuthStepStatus;
    sso: AuthStepStatus;
    validate: AuthStepStatus;
    init: AuthStepStatus;
  };

  // WebSocket health - separate from auth
  websocket: {
    connected: boolean;
    authenticated: boolean;
    lastHeartbeat: Date | null;
  };

  // Data flow - separate from auth success
  dataFlow: {
    receiving: boolean;
    lastTick: Date | null;
    spyPrice: number | null;
    status: 'streaming' | 'stale' | 'none';
  };

  // Error info if in error state
  error?: {
    message: string;
    timestamp: Date;
    recoverable: boolean;
  };

  // Timestamps
  lastUpdated: Date;
}

// Stale timeout: 30 minutes (handles pre-market, overnight gaps)
const STALE_TIMEOUT_MS = 30 * 60 * 1000;

class ConnectionStateManager {
  private state: ConnectionState;
  private listeners: Set<(state: ConnectionState) => void> = new Set();
  private staleCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.state = this.createInitialState();
    this.startStaleCheck();
  }

  private createInitialState(): ConnectionState {
    return {
      phase: 'disconnected',
      auth: {
        oauth: { success: false, timestamp: null },
        sso: { success: false, timestamp: null },
        validate: { success: false, timestamp: null },
        init: { success: false, timestamp: null },
      },
      websocket: {
        connected: false,
        authenticated: false,
        lastHeartbeat: null,
      },
      dataFlow: {
        receiving: false,
        lastTick: null,
        spyPrice: null,
        status: 'none',
      },
      lastUpdated: new Date(),
    };
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    // Immediately send current state
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  /**
   * Get current state (immutable copy)
   */
  getState(): ConnectionState {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Get the computed overall phase
   */
  getPhase(): ConnectionPhase {
    return this.state.phase;
  }

  /**
   * Check if auth is complete (all 4 steps successful)
   */
  isAuthComplete(): boolean {
    const { auth } = this.state;
    return auth.oauth.success && auth.sso.success && auth.validate.success && auth.init.success;
  }

  /**
   * Update an auth step status
   */
  setAuthStep(step: 'oauth' | 'sso' | 'validate' | 'init', success: boolean, error?: string): void {
    this.state.auth[step] = {
      success,
      timestamp: new Date(),
      error: error || undefined,
    };
    this.recomputePhase();
    this.notifyListeners();
  }

  /**
   * Update WebSocket connection status
   */
  setWebSocketStatus(connected: boolean, authenticated: boolean): void {
    this.state.websocket.connected = connected;
    this.state.websocket.authenticated = authenticated;
    if (connected) {
      this.state.websocket.lastHeartbeat = new Date();
    }
    this.recomputePhase();
    this.notifyListeners();
  }

  /**
   * Record a heartbeat from the WebSocket
   */
  recordHeartbeat(): void {
    this.state.websocket.lastHeartbeat = new Date();
  }

  /**
   * Update data flow status (called when SPY data received)
   */
  setDataReceived(spyPrice: number): void {
    this.state.dataFlow = {
      receiving: true,
      lastTick: new Date(),
      spyPrice,
      status: 'streaming',
    };
    this.recomputePhase();
    this.notifyListeners();
  }

  /**
   * Set an error state
   */
  setError(message: string, recoverable: boolean = true): void {
    this.state.error = {
      message,
      timestamp: new Date(),
      recoverable,
    };
    this.state.phase = 'error';
    this.notifyListeners();
  }

  /**
   * Clear error and attempt recovery
   */
  clearError(): void {
    this.state.error = undefined;
    this.recomputePhase();
    this.notifyListeners();
  }

  /**
   * Reset to disconnected state (explicit logout)
   */
  reset(): void {
    this.state = this.createInitialState();
    this.notifyListeners();
  }

  /**
   * Start the stale check interval
   */
  private startStaleCheck(): void {
    // Check every minute for stale data
    this.staleCheckInterval = setInterval(() => {
      this.checkStale();
    }, 60 * 1000);
  }

  /**
   * Check if data has become stale
   */
  private checkStale(): void {
    if (this.state.dataFlow.lastTick) {
      const age = Date.now() - this.state.dataFlow.lastTick.getTime();
      const wasStreaming = this.state.dataFlow.status === 'streaming';

      if (age > STALE_TIMEOUT_MS && wasStreaming) {
        this.state.dataFlow.status = 'stale';
        this.state.dataFlow.receiving = false;
        this.recomputePhase();
        this.notifyListeners();
      }
    }
  }

  /**
   * Recompute the overall phase based on component states
   */
  private recomputePhase(): void {
    // Error state takes precedence (unless cleared)
    if (this.state.error) {
      this.state.phase = 'error';
      return;
    }

    const authComplete = this.isAuthComplete();
    const hasDataFlow = this.state.dataFlow.status === 'streaming';
    const isStale = this.state.dataFlow.status === 'stale';

    if (!authComplete) {
      // Check if any auth step has been attempted
      const anyAttempted =
        this.state.auth.oauth.timestamp !== null ||
        this.state.auth.sso.timestamp !== null ||
        this.state.auth.validate.timestamp !== null ||
        this.state.auth.init.timestamp !== null;

      this.state.phase = anyAttempted ? 'authenticating' : 'disconnected';
    } else if (hasDataFlow) {
      this.state.phase = 'streaming';
    } else if (isStale) {
      this.state.phase = 'stale';
    } else {
      // Auth complete but no data yet
      this.state.phase = 'connected';
    }

    this.state.lastUpdated = new Date();
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners(): void {
    const stateCopy = this.getState();
    this.listeners.forEach(listener => {
      try {
        listener(stateCopy);
      } catch (err) {
        console.error('[ConnectionState] Listener error:', err);
      }
    });

    // Also broadcast via global WebSocket if available
    this.broadcastState(stateCopy);
  }

  /**
   * Broadcast state to connected WebSocket clients
   */
  private broadcastState(state: ConnectionState): void {
    const broadcast = (global as any).broadcastConnectionStatus;
    if (typeof broadcast === 'function') {
      broadcast(state);
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval);
    }
    this.listeners.clear();
  }
}

// Singleton instance
let instance: ConnectionStateManager | null = null;

/**
 * Get the connection state manager instance
 */
export function getConnectionStateManager(): ConnectionStateManager {
  if (!instance) {
    instance = new ConnectionStateManager();
  }
  return instance;
}

/**
 * Get current connection state (convenience function)
 */
export function getConnectionState(): ConnectionState {
  return getConnectionStateManager().getState();
}

/**
 * Check if IBKR is fully connected (auth complete)
 */
export function isIbkrConnected(): boolean {
  return getConnectionStateManager().isAuthComplete();
}

/**
 * Check if IBKR is streaming data
 */
export function isIbkrStreaming(): boolean {
  return getConnectionStateManager().getPhase() === 'streaming';
}
