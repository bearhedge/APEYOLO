import { Option, Position, Order, OrderStatus, AccountInfo, MarketData } from '../types';

/**
 * Common interface for all broker implementations
 */
export interface BrokerInterface {
  // Connection management
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Account information
  getAccountInfo(): Promise<AccountInfo>;
  getPositions(): Promise<Position[]>;
  getPosition(conId: string): Promise<Position | null>;

  // Options trading
  getOptionChain(symbol: string): Promise<Option[]>;
  getOptionPrice(conId: string): Promise<number>;

  // Order management
  placeOrder(order: Order): Promise<OrderStatus>;
  cancelOrder(orderId: string): Promise<boolean>;
  getOrderStatus(orderId: string): Promise<OrderStatus>;
  getOpenOrders(): Promise<Order[]>;

  // Market data
  getMarketData(symbol: string): Promise<MarketData>;
  subscribeMarketData(symbol: string, callback: (data: MarketData) => void): void;
  unsubscribeMarketData(symbol: string): void;
}