# Notes

**Document Purpose**: Captures the capacity constraints and scaling roadmap for 0DTE options trading.

---


## The Mathematical Framework

### Open Interest Rule

**Rule of thumb**: Don't exceed 1-5% of Open Interest (OI) in a single trade.

```
Max Position Size = OI × 0.02 × Contract Price × 100
```

**Example**: SPY 600 PUT has 50,000 OI, trading at $2.00
- Max safe position = 50,000 × 0.02 × $2.00 × 100 = **$200,000 notional**

### Multi-Ticker Allocation Formula

```python
For each ticker in universe:
  1. available_liquidity = min(OI × 0.02, avg_daily_volume × 0.01)
  2. expected_return = model_signal_strength  # from VIX/direction model
  3. risk_adjusted_allocation = expected_return / volatility

# Normalize allocations to sum to 1.0
# Apply: allocation × total_capital × max_position_factor
```

---

## The Key Insight: Same Model, More Instances

The trading model doesn't change at scale. You just run it in parallel:

```
$50K:   1 ticker  × full model
$500K:  1 ticker  × full model
$5M:    5 tickers × full model (each)
```

Same VIX check. Same direction call. Same strike selection. Same sizing logic. Just more instances.

---


## "Step 0": Allocation Engine

At scale, add a pre-filter step before the existing 5-step engine:

```
Step 0: Liquidity & Allocation
  - Fetch OI for all tickers in universe
  - Calculate available liquidity per ticker
  - Apply correlation constraints (don't overweight tech, etc.)
  - Output: { ticker: allocation_amount } for today

Step 1-5: Existing engine (runs per ticker with allocated amount)
```




**Last Updated**: 2025-11-29
