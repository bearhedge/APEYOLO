// @ts-nocheck
// TODO: This file needs refactoring to match updated schema types
// Suppressing TypeScript errors temporarily until refactored

import { BrokerProvider } from '../broker/types';
import type { Position, InsertTrade } from '@shared/schema';

interface NakedOptionStrategyConfig {
  // Capital and risk management
  capitalHKD: number;           // Base capital in HKD (dynamically fetched)
  marginMultiplier: number;     // Margin multiplier for buying power
  maxContractsPerSide: number;  // Maximum contracts per side (dynamically calculated)

  // Option selection criteria
  maxDelta: number;             // Maximum delta for option selection
  daysToExpiration: number;     // Target days to expiration (0 for 0DTE)

  // Stop loss configuration
  stopLossPercentage: number;   // Stop loss as % of premium collected

  // Trading window (HK time)
  tradingStartHour: number;     // Start hour (24h format)
  tradingEndHour: number;       // End hour (24h format)

  // Options margin multiplier for contract calculation
  optionsMarginMultiplier: number;  // Multiplier for options margin vs shares (default 2)
}

export class NakedOptionStrategy {
  private config: NakedOptionStrategyConfig;
  private broker: BrokerProvider;
  private currentPositions: Map<string, Position> = new Map();
  private isInitialized: boolean = false;

  constructor(broker: BrokerProvider) {
    this.broker = broker;

    // Initialize with default parameters (will be updated in initialize())
    this.config = {
      capitalHKD: 0,  // Will be fetched dynamically
      marginMultiplier: 6.66,
      maxContractsPerSide: 0,  // Will be calculated dynamically

      // Delta < 0.30 for option selection
      maxDelta: 0.30,
      daysToExpiration: 0,  // 0DTE trading

      // Risk management
      stopLossPercentage: 200,  // Stop at 2x premium loss

      // Trading window 12-2 PM HK time
      tradingStartHour: 12,
      tradingEndHour: 14,

      // Options margin multiplier
      optionsMarginMultiplier: 2  // Can sell ~2x more options vs shares
    };
  }

  /**
   * Initialize strategy with actual account data
   */
  async initialize(): Promise<void> {
    try {
      // Fetch actual account NAV
      const accountInfo = await this.broker.getAccount();
      const navHKD = accountInfo.portfolioValue;  // This is already in HKD for paper account

      // Update capital based on actual NAV
      this.config.capitalHKD = navHKD;

      // Calculate max contracts based on buying power and SPY price
      // For now, use a rough estimate (can be refined with actual SPY price later)
      const spyPriceHKD = 590 * 7.8;  // Roughly 590 USD × 7.8 HKD/USD = 4,602 HKD
      const buyingPower = navHKD * this.config.marginMultiplier;
      const baseContracts = Math.floor((buyingPower / spyPriceHKD) / 100);
      this.config.maxContractsPerSide = Math.floor(baseContracts * this.config.optionsMarginMultiplier);

      this.isInitialized = true;

      console.log('=== Strategy Initialized ===');
      console.log(`NAV: ${navHKD.toLocaleString()} HKD`);
      console.log(`Buying Power: ${buyingPower.toLocaleString()} HKD`);
      console.log(`Max Contracts per Side: ${this.config.maxContractsPerSide}`);
    } catch (error) {
      console.error('Failed to initialize strategy:', error);
      throw error;
    }
  }

  /**
   * Check if we're within the allowed trading window
   */
  private isWithinTradingWindow(): boolean {
    const now = new Date();
    // Convert to HK time (UTC+8)
    const hkHour = (now.getUTCHours() + 8) % 24;

    return hkHour >= this.config.tradingStartHour &&
           hkHour < this.config.tradingEndHour;
  }

  /**
   * Calculate available buying power
   */
  private getAvailableBuyingPower(): number {
    return this.config.capitalHKD * this.config.marginMultiplier;
  }

  /**
   * Get current open positions by side
   */
  private getPositionsBySide(side: 'PUT' | 'CALL'): Position[] {
    const positions: Position[] = [];
    for (const position of this.currentPositions.values()) {
      if (position.contract.right === side && position.quantity !== 0) {
        positions.push(position);
      }
    }
    return positions;
  }

  /**
   * Check if we can open more contracts on a given side
   */
  private canOpenPosition(side: 'PUT' | 'CALL'): boolean {
    const currentPositions = this.getPositionsBySide(side);
    const totalContracts = currentPositions.reduce((sum, p) => sum + Math.abs(p.quantity), 0);
    return totalContracts < this.config.maxContractsPerSide;
  }

  /**
   * Find suitable options to sell
   */
  private async findOptionsToSell(
    symbol: string,
    side: 'PUT' | 'CALL'
  ): Promise<Option[]> {
    // Get option chain from broker
    const optionChain = await this.broker.getOptionChain(symbol);

    // Filter options based on criteria
    const suitableOptions = optionChain.filter(option => {
      // Check option type
      if (option.right !== side) return false;

      // Check delta (must be less than max delta)
      if (Math.abs(option.greeks?.delta || 0) > this.config.maxDelta) return false;

      // Check days to expiration - for 0DTE, we want options expiring today or tomorrow
      const daysToExp = this.calculateDaysToExpiration(option.expiry);
      if (daysToExp > 1) return false;  // Only 0-1 DTE options

      return true;
    });

    // Sort by premium (highest first)
    suitableOptions.sort((a, b) => b.bid - a.bid);

    return suitableOptions;
  }

  /**
   * Calculate days to expiration
   */
  private calculateDaysToExpiration(expiry: string): number {
    const expiryDate = new Date(expiry);
    const now = new Date();
    const diffMs = expiryDate.getTime() - now.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Place stop loss orders
   */
  private async placeRiskManagementOrders(
    position: Position,
    premiumCollected: number
  ): Promise<void> {
    const stopLossPrice = premiumCollected * (1 + this.config.stopLossPercentage / 100);

    // Place stop loss order (buy to close)
    await this.broker.placeOrder({
      symbol: position.contract.symbol,
      quantity: Math.abs(position.quantity),
      side: 'BUY',
      orderType: 'STOP',
      stopPrice: stopLossPrice,
      timeInForce: 'GTC',
      contract: position.contract
    });

    console.log(`Stop loss order placed for ${position.contract.symbol}:`);
    console.log(`  Stop Loss: ${stopLossPrice.toFixed(2)} HKD`);
  }

  /**
   * Execute the naked option selling strategy
   */
  public async execute(symbol: string = 'SPY'): Promise<void> {
    // Ensure strategy is initialized
    if (!this.isInitialized) {
      console.log('Initializing strategy with account data...');
      await this.initialize();
    }

    console.log('=== Naked Option Selling Strategy ===');
    console.log(`Capital (NAV): ${this.config.capitalHKD.toLocaleString()} HKD`);
    console.log(`Buying Power: ${this.getAvailableBuyingPower().toLocaleString()} HKD`);
    console.log(`Max Delta: ${this.config.maxDelta}`);
    console.log(`Max Contracts per Side: ${this.config.maxContractsPerSide}`);
    console.log(`Trading 0DTE Options`);

    // Check trading window
    if (!this.isWithinTradingWindow()) {
      console.log('Outside trading window (12-2 PM HK time). Skipping execution.');
      return;
    }

    // Update current positions from broker
    const positions = await this.broker.getPositions();
    this.currentPositions.clear();
    for (const position of positions) {
      if (position.contract.secType === 'OPT') {
        this.currentPositions.set(position.contract.conId, position);
      }
    }

    // Check and open PUT positions
    if (this.canOpenPosition('PUT')) {
      console.log('\nSearching for PUT options to sell...');
      const putOptions = await this.findOptionsToSell(symbol, 'PUT');

      if (putOptions.length > 0) {
        const selectedPut = putOptions[0];
        console.log(`Found PUT to sell: ${selectedPut.symbol} Strike: ${selectedPut.strike} Delta: ${selectedPut.greeks?.delta}`);

        // Place sell order
        const order = await this.broker.placeOrder({
          symbol: selectedPut.symbol,
          quantity: 1,  // Start with 1 contract
          side: 'SELL',
          orderType: 'LIMIT',
          limitPrice: selectedPut.bid,
          timeInForce: 'DAY',
          contract: {
            symbol: selectedPut.symbol,
            secType: 'OPT',
            strike: selectedPut.strike,
            right: 'PUT',
            expiry: selectedPut.expiry,
            conId: selectedPut.conId
          }
        });

        if (order.status === 'FILLED') {
          // Place risk management orders
          const position = await this.broker.getPosition(selectedPut.conId);
          if (position) {
            await this.placeRiskManagementOrders(position, selectedPut.bid * 100);
          }
        }
      }
    }

    // Check and open CALL positions
    if (this.canOpenPosition('CALL')) {
      console.log('\nSearching for CALL options to sell...');
      const callOptions = await this.findOptionsToSell(symbol, 'CALL');

      if (callOptions.length > 0) {
        const selectedCall = callOptions[0];
        console.log(`Found CALL to sell: ${selectedCall.symbol} Strike: ${selectedCall.strike} Delta: ${selectedCall.greeks?.delta}`);

        // Place sell order
        const order = await this.broker.placeOrder({
          symbol: selectedCall.symbol,
          quantity: 1,  // Start with 1 contract
          side: 'SELL',
          orderType: 'LIMIT',
          limitPrice: selectedCall.bid,
          timeInForce: 'DAY',
          contract: {
            symbol: selectedCall.symbol,
            secType: 'OPT',
            strike: selectedCall.strike,
            right: 'CALL',
            expiry: selectedCall.expiry,
            conId: selectedCall.conId
          }
        });

        if (order.status === 'FILLED') {
          // Place risk management orders
          const position = await this.broker.getPosition(selectedCall.conId);
          if (position) {
            await this.placeRiskManagementOrders(position, selectedCall.bid * 100);
          }
        }
      }
    }

    // Monitor existing positions
    await this.monitorPositions();
  }

  /**
   * Monitor and manage existing positions
   */
  private async monitorPositions(): Promise<void> {
    console.log('\n=== Monitoring Existing Positions ===');

    for (const position of this.currentPositions.values()) {
      const currentPrice = await this.broker.getOptionPrice(position.contract.conId);
      const unrealizedPnL = position.unrealizedPnL || 0;

      console.log(`${position.contract.symbol} ${position.contract.strike} ${position.contract.right}:`);
      console.log(`  Quantity: ${position.quantity}`);
      console.log(`  Avg Cost: ${position.averageCost}`);
      console.log(`  Current Price: ${currentPrice}`);
      console.log(`  Unrealized P&L: ${unrealizedPnL.toFixed(2)} HKD`);

      // Check if position needs adjustment
      if (Math.abs(unrealizedPnL) > position.averageCost * 2) {
        console.log(`  ⚠️ Position requires attention - consider rolling or closing`);
      }
    }
  }

  /**
   * Get strategy status and metrics
   */
  public async getStatus(): Promise<any> {
    // Ensure strategy is initialized
    if (!this.isInitialized) {
      await this.initialize();
    }

    const positions = await this.broker.getPositions();
    const optionPositions = positions.filter(p => p.contract.secType === 'OPT');

    const putPositions = optionPositions.filter(p => p.contract.right === 'PUT');
    const callPositions = optionPositions.filter(p => p.contract.right === 'CALL');

    const totalPnL = optionPositions.reduce((sum, p) => sum + (p.unrealizedPnL || 0), 0);

    return {
      strategy: 'Naked Option Selling (0DTE)',
      config: {
        capital: this.config.capitalHKD,
        buyingPower: this.getAvailableBuyingPower(),
        maxDelta: this.config.maxDelta,
        maxContractsPerSide: this.config.maxContractsPerSide,
        optionsMarginMultiplier: this.config.optionsMarginMultiplier
      },
      positions: {
        puts: putPositions.length,
        calls: callPositions.length,
        total: optionPositions.length
      },
      performance: {
        unrealizedPnL: totalPnL,
        utilizationPercentage: (optionPositions.length / (this.config.maxContractsPerSide * 2)) * 100
      },
      tradingWindow: {
        active: this.isWithinTradingWindow(),
        hours: `${this.config.tradingStartHour}:00 - ${this.config.tradingEndHour}:00 HK`
      }
    };
  }
}