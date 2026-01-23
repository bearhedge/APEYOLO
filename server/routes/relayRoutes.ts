/**
 * TWS Relay Socket.IO Routes
 *
 * Handles Socket.IO connections from local TWS relay clients.
 * Enables users to execute trades via their local TWS/Gateway.
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server } from 'http';
import { validateApiKeyFromQuery } from '../middleware/apiKeyAuth';

// Store connected relay clients by userId
const relayClients = new Map<string, RelayConnection>();

interface RelayConnection {
  socket: Socket;
  userId: string;
  connectedAt: Date;
  lastActivity: Date;
}

export interface TradeSignal {
  id: string;
  action: 'BUY' | 'SELL';
  symbol: string;
  secType: 'STK' | 'OPT';
  quantity: number;
  orderType: 'MKT' | 'LMT';
  limitPrice?: number;
  expiry?: string;
  strike?: number;
  right?: 'C' | 'P';
}

let io: SocketIOServer | null = null;

/**
 * Initialize the relay Socket.IO server
 */
export function initRelayWebSocket(httpServer: Server): void {
  io = new SocketIOServer(httpServer, {
    path: '/relay',
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  console.log('[Relay] Socket.IO server initialized at /relay');

  io.on('connection', (socket) => {
    console.log('[Relay] New connection:', socket.id);
    let authenticatedUserId: string | null = null;

    socket.on('auth', async (data: { apiKey: string }) => {
      const { apiKey } = data;

      if (!apiKey) {
        socket.emit('auth_error', { message: 'Missing API key' });
        socket.disconnect();
        return;
      }

      const userId = await validateApiKeyFromQuery(apiKey);
      if (!userId) {
        socket.emit('auth_error', { message: 'Invalid API key' });
        socket.disconnect();
        return;
      }

      const existing = relayClients.get(userId);
      if (existing) {
        existing.socket.emit('replaced', { message: 'Connection replaced' });
        existing.socket.disconnect();
      }

      authenticatedUserId = userId;
      relayClients.set(userId, {
        socket,
        userId,
        connectedAt: new Date(),
        lastActivity: new Date(),
      });

      console.log(`[Relay] User ${userId} authenticated`);
      socket.emit('auth_success', { message: 'Authenticated successfully' });
    });

    socket.on('response', (data: { id: string; result: any }) => {
      if (!authenticatedUserId) return;
      const conn = relayClients.get(authenticatedUserId);
      if (conn) conn.lastActivity = new Date();
      console.log(`[Relay] Response from ${authenticatedUserId}:`, data);
    });

    socket.on('error_response', (data: { id: string; error: string }) => {
      if (!authenticatedUserId) return;
      console.error(`[Relay] Error from ${authenticatedUserId}:`, data);
    });

    socket.on('disconnect', (reason) => {
      if (authenticatedUserId) {
        console.log(`[Relay] User ${authenticatedUserId} disconnected: ${reason}`);
        relayClients.delete(authenticatedUserId);
      }
    });
  });
}

export function sendTradeSignal(userId: string, signal: TradeSignal): boolean {
  const conn = relayClients.get(userId);
  if (!conn || !conn.socket.connected) return false;

  try {
    conn.socket.emit('request', signal);
    console.log(`[Relay] Sent trade signal to ${userId}:`, signal);
    return true;
  } catch (error) {
    console.error(`[Relay] Failed to send signal to ${userId}:`, error);
    return false;
  }
}

export function hasRelayConnection(userId: string): boolean {
  const conn = relayClients.get(userId);
  return !!conn && conn.socket.connected;
}

export function getRelayStatus(userId: string): {
  connected: boolean;
  connectedAt?: Date;
  lastActivity?: Date;
} {
  const conn = relayClients.get(userId);
  if (!conn || !conn.socket.connected) {
    return { connected: false };
  }
  return {
    connected: true,
    connectedAt: conn.connectedAt,
    lastActivity: conn.lastActivity,
  };
}

export function getRelayClientCount(): number {
  return relayClients.size;
}
