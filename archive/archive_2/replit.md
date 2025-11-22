# Overview

APEYOLO is a professional options trading platform featuring AI-powered automation, institutional-grade risk management, and immutable audit trails. The application uses a clean monochrome design aesthetic with Century Gothic typography throughout. Built as an end-to-end agentic options seller MVP, it provides simple onboarding, automated trading capabilities, and comprehensive oversight tools for systematic traders who value precision and control.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

**Technology Stack:**
- React 18 with TypeScript and Vite as the build tool
- Wouter for client-side routing
- TanStack Query for server state management and data fetching
- Zustand with persist middleware for client-side state management
- Tailwind CSS for styling with custom monochrome design system
- shadcn/ui components built on Radix UI primitives

**Design System:**
- Strict monochrome color palette: Pure Black (#000000), Charcoal (#0B0B0B), Dark Gray (#1A1A1A), Mid Gray (#2B2B2B), Silver (#A6A6A6), White (#FFFFFF)
- Century Gothic font family used exclusively for all text
- Status colors for success/error states: Green (#10B981), Red (#EF4444), Blue (#3B82F6), Amber (#F59E0B)
- Hairline borders using rgba(255,255,255,0.1) for subtle visual separation
- No gradients, neon colors, or animated backgrounds - minimalist professional aesthetic

**Application Routes:**
- Home (`/`) - Landing page with value proposition
- Onboarding (`/onboarding`) - Multi-step setup: Google OAuth → IBKR connection → Risk preferences
- Agent (`/agent`) - Main trading interface with three-column layout: LeftNav navigation, ChatCanvas for agentic commands, and ContextPanel showing Session/Portfolio/Risk/Allocation/Queue/Alerts cards
- Portfolio (`/portfolio`) - Portfolio overview and holdings
- Trades (`/trades`) - Trade history and execution details
- Jobs (`/jobs`) - Background job queue and task management
- PNL (`/pnl`) - Immutable trade history with cryptographic hashing for audit compliance
- Settings (`/settings`) - IBKR connection management, risk controls, safety rails, notifications, and agent configuration

**Page Layout:**
- Agent page uses three-column layout: LeftNav (icon navigation) + ChatCanvas (natural language interface) + ContextPanel (6 cards in fixed order: Session → Portfolio → Risk → Allocation → Queue → Alerts)
- All other pages use LeftNav for consistent navigation across the application

**State Management:**
- Zustand store handles authentication state (Google, IBKR connection)
- Broker diagnostics state (OAuth, SSO, init status with traceId)
- Agent state (running/stopped/error status, strategy, symbols)
- Risk configuration (aggression, leverage, daily loss limits, per-symbol exposure)
- All risk preferences persisted to localStorage

## Backend Architecture

**Server Technology:**
- Node.js Express server with TypeScript
- ESM module system
- WebSocket server for real-time price updates and live data streaming
- RESTful API endpoints following resource-based routing patterns

**Core API Endpoints:**
- `/api/broker/diag` - IBKR connection diagnostics (OAuth, SSO, brokerage session status)
- `/api/broker/oauth` - OAuth 2.0 token exchange
- `/api/broker/sso` - SSO session creation and validation
- `/api/account` - Account information (NAV, buying power, margin)
- `/api/positions` - Open positions management
- `/api/pnl` - Immutable P&L history
- `/api/agent/status` - Agent status monitoring
- `/api/agent/start` - Start automated trading agent
- `/api/agent/stop` - Stop automated trading agent

**Broker Architecture:**
- Pluggable broker provider system with interface-based design
- Mock provider for development/testing
- IBKR provider for live trading
- JWT-based OAuth 2.0 authentication with RS256 signing
- Private key JWT (private_key_jwt) client assertion method
- Multi-phase session initialization: OAuth → SSO → Brokerage Session
- Comprehensive diagnostics with request tracing

**Data Flow:**
- API layer with typed functions returns mocks when backend returns 404
- Graceful degradation for development without live broker connection
- WebSocket connection for live market data updates
- Query invalidation strategy for real-time data freshness

## Data Storage Solutions

**Database:**
- Drizzle ORM configured for PostgreSQL (currently using Neon serverless)
- Schema includes users, positions, trades, risk_rules, and audit_logs tables
- In-memory storage implementation for development (server/storage.ts)
- Interface-based storage layer allows swapping between in-memory and database implementations

**Database Schema Design:**
- Users: Authentication with username/password
- Positions: Track symbol, strategy (put_credit/call_credit), strikes, expiration, quantity, credits, P&L, Greeks (delta), margin requirements
- Trades: Order history with symbol, strategy, strikes, expiration, quantity, credit, status, submission timestamp
- Risk Rules: JSON configuration storage for trading parameters, risk limits, validation rules, market conditions
- Audit Logs: Immutable event logging with event type, details, user, status, timestamp

**Cryptographic Hashing:**
- SHA-256 hashing implemented in browser using Web Crypto API
- Row-level hashing for individual P&L records
- Dataset-level hash computed from combined row hashes
- Ensures immutability and enables compliance verification

## External Dependencies

**IBKR Integration:**
- OAuth 2.0 authentication flow using private_key_jwt method
- PKCS#8 PEM format private key for RS256 JWT signing
- Required environment variables: IBKR_CLIENT_ID, IBKR_CLIENT_KEY_ID, IBKR_CREDENTIAL, IBKR_PRIVATE_KEY, IBKR_ALLOWED_IP, IBKR_BASE_URL
- Multi-phase authentication: OAuth token → SSO session → Brokerage session initialization
- Diagnostic endpoints track OAuth (200), SSO (200), and Init (200) status with traceId for debugging
- Support for both paper and live trading environments

**External Services:**
- Google OAuth (planned for authentication)
- OpenAI SDK integration (planned for AI agent decision making)
- GPT-4 model for strategy execution with customizable system prompts
- Webhook/notification services (email, Slack) for trade alerts and risk breaches

**Third-Party Libraries:**
- jose for JWT operations (signing, verification)
- jsonwebtoken for legacy JWT support
- @neondatabase/serverless for PostgreSQL connection
- ws for WebSocket server implementation
- connect-pg-simple for PostgreSQL session storage
- date-fns for date manipulation
- cmdk for command palette functionality

**Development Tools:**
- Vite with HMR and custom plugins (@replit/vite-plugin-runtime-error-modal)
- ESBuild for server bundling
- tsx for TypeScript execution
- Drizzle Kit for database migrations