import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WINDOW_CONFIGS } from '@/hooks/useWindowManager';

/**
 * PreviewHeader - Dimmed version of terminal header for landing page
 */
function PreviewHeader() {
  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 40,
        background: '#707070',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 24,
        zIndex: 50,
        fontSize: 13,
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
        {/* Candle icon */}
        <div style={{ display: 'flex', gap: 3, alignItems: 'center', height: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: 1, height: 2, background: 'currentColor' }} />
            <div style={{ width: 4, height: 10, background: '#4ade80' }} />
            <div style={{ width: 1, height: 2, background: 'currentColor' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: 1, height: 2, background: 'currentColor' }} />
            <div style={{ width: 4, height: 8, background: '#ef4444' }} />
            <div style={{ width: 1, height: 2, background: 'currentColor' }} />
          </div>
        </div>
        <span>APE YOLO</span>
      </div>

      {/* Market Data placeholder */}
      <div style={{ display: 'flex', gap: 20, fontSize: 12, marginLeft: 'auto', marginRight: 'auto' }}>
        <div style={{ display: 'flex', gap: 6, color: '#fff' }}>
          <span>SPY</span>
          <span>--</span>
        </div>
        <div style={{ display: 'flex', gap: 6, color: '#fff' }}>
          <span>VIX</span>
          <span>--</span>
        </div>
      </div>

      {/* Clocks placeholder */}
      <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
        <span style={{ color: '#4dd0e1' }}>HK --:--:--</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ color: '#7ec8a3' }}>NY --:--:--</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={{ color: '#ffa8a8' }}>LON --:--:--</span>
      </div>
    </header>
  );
}

/**
 * PreviewDock - Dimmed version of dock for landing page
 */
function PreviewDock() {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        zIndex: 50,
        fontSize: 13,
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      {/* Prompt */}
      <span style={{ color: '#707070', marginRight: 4 }}>$</span>

      {/* Blinking cursor */}
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 16,
          background: '#fff',
          animation: 'blink 1s step-end infinite',
          verticalAlign: 'text-bottom',
          marginRight: 12,
        }}
      />

      {/* Window buttons */}
      {WINDOW_CONFIGS.map(config => (
        <button
          key={config.id}
          disabled
          style={{
            padding: '8px 14px',
            background: 'transparent',
            border: '1px solid #333',
            color: '#888',
            fontSize: 12,
            cursor: 'not-allowed',
            fontFamily: 'inherit',
          }}
        >
          {config.title}
        </button>
      ))}

      {/* Blink animation */}
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

export function Home() {
  return (
    <div className="min-h-screen relative bg-black">
      {/* Dimmed preview header */}
      <div className="opacity-35 pointer-events-none">
        <PreviewHeader />
      </div>

      {/* Centered login content */}
      <div className="absolute inset-0 flex items-center justify-center px-6 z-[100]">
        <div className="text-center">
          <img
            src="/ape-logo.png"
            alt="APE YOLO Logo"
            className="w-72 h-72 mx-auto mb-2 object-contain"
          />
          <h1 className="text-6xl md:text-7xl font-bold mb-4 tracking-wide" data-testid="text-hero-title">
            APE YOLO
          </h1>
          <p className="text-2xl md:text-3xl text-white mb-2 tracking-wide" data-testid="text-hero-tagline">
            THE SAFEST WAY TO YOLO
          </p>
          <p className="text-lg mb-8 bg-gradient-to-r from-pink-500 via-purple-500 via-blue-500 via-cyan-400 via-green-400 via-yellow-400 to-orange-500 bg-clip-text text-transparent">
            Automated 0DTE SPY/SPX options trading
          </p>
          <Button
            onClick={() => { window.location.href = '/api/auth/google'; }}
            className="btn-primary text-lg px-8 py-6 h-auto"
            data-testid="button-get-started"
          >
            Get Started
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </div>
      </div>

      {/* Dimmed preview dock */}
      <div className="opacity-35 pointer-events-none">
        <PreviewDock />
      </div>
    </div>
  );
}
