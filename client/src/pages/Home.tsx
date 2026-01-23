import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
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
  );
}
