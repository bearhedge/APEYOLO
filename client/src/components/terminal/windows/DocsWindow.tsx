/**
 * DocsWindow - Documentation viewer with sidebar navigation and search
 *
 * Features: search bar, clickable sidebar nav, scrollable content area.
 */

import { useState, useRef, useEffect } from 'react';

interface DocSection {
  id: string;
  title: string;
  content: string;
}

const DOCS_SECTIONS: DocSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    content: `Welcome to APE YOLO - The Safest Way to YOLO.

This platform provides automated options trading with risk management
and position sizing based on your configured mandate.

Quick Start:
1. Connect your IBKR account in Settings
2. Configure your trading mandate (max position size, risk limits)
3. Enable the trading engine
4. Monitor positions and trades in real-time

The system will automatically manage entries, exits, and position
sizing based on market conditions and your risk parameters.`,
  },
  {
    id: 'trading-engine',
    title: 'Trading Engine',
    content: `The trading engine (engine.exe) is the core automated trading system.

Engine States:
- IDLE: Engine is not running, no trades will be executed
- RUNNING: Engine is actively monitoring and executing trades
- PAUSED: Engine is temporarily suspended

Engine Steps:
1. Market Analysis - Evaluates current market conditions
2. Signal Generation - Identifies potential trade opportunities
3. Risk Check - Validates against mandate constraints
4. Order Execution - Places orders through IBKR
5. Position Management - Monitors and adjusts open positions

The engine respects all mandate constraints and will not exceed
your configured risk limits.`,
  },
  {
    id: 'positions-orders',
    title: 'Positions & Orders',
    content: `Positions Window (positions/):
Displays all current open positions including:
- Symbol and expiration
- Quantity and average cost
- Current P&L (realized and unrealized)
- Delta and other Greeks

Trades Log (trades.log):
Historical record of all executed trades including:
- Entry and exit timestamps
- Fill prices and quantities
- Commission and fees
- Trade outcome (win/loss)

Order Status:
- PENDING: Order submitted, awaiting fill
- FILLED: Order fully executed
- PARTIAL: Order partially filled
- CANCELLED: Order cancelled by user or system`,
  },
  {
    id: 'settings-config',
    title: 'Settings & Configuration',
    content: `Settings Window (settings.cfg):

IBKR Connection:
- Status: Shows current connection state
- Account: Linked IBKR account ID
- Mode: Paper or Live trading
- Test Connection: Verify broker connectivity

Solana Wallet:
- Network: Mainnet or devnet
- Address: Connected wallet address
- Balance: Current SOL balance

Preferences:
- Data Source: WebSocket (real-time) or REST (polling)
- Environment: Paper (simulated) or Live (real money)

Order Management:
- Test Order: Submit a test order to verify execution
- Clear Orders: Cancel all open orders`,
  },
  {
    id: 'keyboard-shortcuts',
    title: 'Keyboard Shortcuts',
    content: `Global Shortcuts:

Escape     - Close all open windows
Ctrl+1     - Toggle mandate window
Ctrl+2     - Toggle positions window
Ctrl+3     - Toggle trades window
Ctrl+4     - Toggle stats window
Ctrl+5     - Toggle engine window
Ctrl+6     - Toggle settings window

Window Controls:
- Click title bar to drag
- Drag edges to resize
- Click anywhere to bring to front
- Click X to close`,
  },
  {
    id: 'api-reference',
    title: 'API Reference',
    content: `REST API Endpoints:

GET  /api/ibkr/status     - Broker connection status
POST /api/ibkr/test       - Test broker connection
POST /api/broker/warm     - Initialize broker session
GET  /api/account         - Account summary and NAV
GET  /api/positions       - Current open positions
GET  /api/trades          - Trade history
GET  /api/engine/status   - Engine state and metrics
POST /api/engine/start    - Start trading engine
POST /api/engine/stop     - Stop trading engine
GET  /api/mandate         - Current mandate config
POST /api/mandate         - Update mandate config

WebSocket Channels:
- /ws/positions  - Real-time position updates
- /ws/trades     - Real-time trade notifications
- /ws/engine     - Engine status changes`,
  },
];

export function DocsWindow() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSection, setActiveSection] = useState('getting-started');
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Filter sections based on search
  const filteredSections = searchQuery
    ? DOCS_SECTIONS.filter(
        section =>
          section.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          section.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : DOCS_SECTIONS;

  // Scroll to section when clicked in sidebar
  const scrollToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    const element = sectionRefs.current[sectionId];
    if (element && contentRef.current) {
      contentRef.current.scrollTo({
        top: element.offsetTop - 10,
        behavior: 'smooth',
      });
    }
  };

  // Update active section on scroll
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      for (const section of DOCS_SECTIONS) {
        const element = sectionRefs.current[section.id];
        if (element) {
          const offsetTop = element.offsetTop - 20;
          const offsetBottom = offsetTop + element.offsetHeight;
          if (scrollTop >= offsetTop && scrollTop < offsetBottom) {
            setActiveSection(section.id);
            break;
          }
        }
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Highlight search matches in content
  const highlightText = (text: string, query: string) => {
    if (!query) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <span key={i} style={{ background: '#4a4a00', color: '#ffff00' }}>
          {part}
        </span>
      ) : (
        part
      )
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 12,
      }}
    >
      {/* Search Bar */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #222' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search docs..."
          style={{
            width: '100%',
            padding: '6px 10px',
            background: '#111',
            border: '1px solid #333',
            color: '#fff',
            fontSize: 11,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <div
          style={{
            width: 180,
            borderRight: '1px solid #222',
            padding: '8px 0',
            overflowY: 'auto',
          }}
        >
          {DOCS_SECTIONS.map(section => {
            const isActive = activeSection === section.id;
            const isVisible = filteredSections.some(s => s.id === section.id);

            return (
              <button
                key={section.id}
                onClick={() => scrollToSection(section.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '6px 12px',
                  background: isActive ? '#1a1a1a' : 'transparent',
                  border: 'none',
                  borderLeft: isActive ? '2px solid #87ceeb' : '2px solid transparent',
                  color: isVisible ? (isActive ? '#87ceeb' : '#888') : '#444',
                  fontSize: 11,
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  opacity: isVisible ? 1 : 0.5,
                }}
              >
                {section.title}
              </button>
            );
          })}
        </div>

        {/* Content Area */}
        <div
          ref={contentRef}
          style={{
            flex: 1,
            padding: '12px 16px',
            overflowY: 'auto',
          }}
        >
          {filteredSections.length === 0 ? (
            <p style={{ color: '#666', fontSize: 11 }}>No results found for "{searchQuery}"</p>
          ) : (
            filteredSections.map(section => (
              <div
                key={section.id}
                ref={el => (sectionRefs.current[section.id] = el)}
                style={{ marginBottom: 24 }}
              >
                <h3
                  style={{
                    color: '#87ceeb',
                    fontSize: 13,
                    marginBottom: 8,
                    borderBottom: '1px solid #222',
                    paddingBottom: 4,
                  }}
                >
                  &gt; {section.title}
                </h3>
                <pre
                  style={{
                    color: '#ccc',
                    fontSize: 11,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    wordWrap: 'break-word',
                    margin: 0,
                  }}
                >
                  {highlightText(section.content, searchQuery)}
                </pre>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
