import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Home() {
  return (
    <div className="min-h-screen relative bg-black">
      {/* Centered login content */}
      <div className="absolute inset-0 flex items-center justify-center px-6 z-[100]">
        <div className="text-center">
          <img
            src="/ape-logo.png"
            alt="APE YOLO Logo"
            className="w-[360px] h-[360px] mx-auto mb-2 object-contain"
          />
          <h1 className="text-7xl md:text-8xl font-bold mb-5 tracking-wide" data-testid="text-hero-title">
            APE YOLO
          </h1>
          <p className="text-3xl md:text-4xl text-white mb-3 tracking-wide" data-testid="text-hero-tagline">
            THE SAFEST WAY TO YOLO
          </p>
          <p
            className="text-xl mb-10 font-medium"
            style={{
              background: 'linear-gradient(90deg, #4ade80, #22d3ee, #3b82f6, #a855f7, #ec4899, #f97316, #eab308, #4ade80)',
              backgroundSize: '200% 100%',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              animation: 'colorShift 4s linear infinite',
            }}
          >
            Automated 0DTE SPY/SPX options trading
          </p>
          <style>{`
            @keyframes colorShift {
              0% { background-position: 0% 50%; }
              100% { background-position: 200% 50%; }
            }
          `}</style>
          <Button
            onClick={() => { window.location.href = '/api/auth/google'; }}
            className="btn-primary text-xl px-10 py-7 h-auto"
            data-testid="button-get-started"
          >
            Get Started
            <ArrowRight className="w-6 h-6 ml-2" />
          </Button>
        </div>
      </div>

    </div>
  );
}
