import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';

const TAGLINE = "AUTOMATED 0DTE SPY/SPX OPTIONS TRADING";

// Hong Kong neon palette - 90s Wanchai/TST aesthetic
const NEON_PALETTES = [
  // Classic HK neon - hot pink, cyan, green
  ['#ff1493', '#00ffff', '#39ff14', '#ff073a', '#ff00ff', '#00ff88'],
  // Electric blue dominant
  ['#00d4ff', '#0099ff', '#00ffff', '#ff00ff', '#39ff14', '#00ff88'],
  // Hot pink dominant
  ['#ff1493', '#ff00ff', '#ff073a', '#ff69b4', '#00ffff', '#39ff14'],
  // Green neon signs
  ['#39ff14', '#00ff88', '#00ffff', '#00ff00', '#ff1493', '#ff00ff'],
  // Red/pink night market
  ['#ff073a', '#ff1493', '#ff00ff', '#ff4500', '#00ffff', '#39ff14'],
];

// Animation definitions - each has a name and duration (2-3x longer to enjoy each one)
const ANIMATIONS = [
  { name: 'typewriter', duration: 8000 },
  { name: 'wave', duration: 12000 },
  { name: 'jiggle', duration: 10000 },
  { name: 'flyInLeft', duration: 8000 },
  { name: 'flyInRight', duration: 8000 },
  { name: 'flyInTop', duration: 8000 },
  { name: 'flyInBottom', duration: 8000 },
  { name: 'bounceIn', duration: 8000 },
  { name: 'glitch', duration: 10000 },
  { name: 'scramble', duration: 10000 },
  { name: 'rubberBand', duration: 10000 },
  { name: 'flip3D', duration: 10000 },
  { name: 'neonFlicker', duration: 10000 },
  { name: 'explode', duration: 12000 },
  { name: 'swing', duration: 10000 },
  { name: 'zoomPulse', duration: 10000 },
  { name: 'spiral', duration: 10000 },
  { name: 'matrix', duration: 12000 },
  { name: 'disco', duration: 10000 },
  { name: 'earthquake', duration: 10000 },
  { name: 'slot', duration: 10000 },
  { name: 'bounce', duration: 10000 },
  { name: 'rainbow', duration: 12000 },
];

function WildTagline() {
  const [animationIndex, setAnimationIndex] = useState(0);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [colorOffset, setColorOffset] = useState(0);
  const [key, setKey] = useState(0); // Force re-render on animation change

  const currentAnimation = ANIMATIONS[animationIndex];
  const currentPalette = NEON_PALETTES[paletteIndex];

  // Animation cycling
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimationIndex((prev) => (prev + 1) % ANIMATIONS.length);
      // Change palette every 3 animations for variety
      if ((animationIndex + 1) % 3 === 0) {
        setPaletteIndex((prev) => (prev + 1) % NEON_PALETTES.length);
      }
      setKey((prev) => prev + 1);
    }, currentAnimation.duration);

    return () => clearTimeout(timer);
  }, [animationIndex, currentAnimation.duration]);

  // Continuous color shifting - cycles colors through letters
  useEffect(() => {
    const colorTimer = setInterval(() => {
      setColorOffset((prev) => (prev + 1) % currentPalette.length);
    }, 320); // Shift every 320ms for smoother wave effect

    return () => clearInterval(colorTimer);
  }, [currentPalette.length]);

  const getLetterStyle = (index: number, char: string): React.CSSProperties => {
    // Color shifts through letters like a wave
    const colorIndex = (index + colorOffset) % currentPalette.length;
    const baseColor = currentPalette[colorIndex];
    const delay = index * 0.05;

    const base: React.CSSProperties = {
      display: 'inline-block',
      color: baseColor,
      // Subtler neon glow - cleaner aesthetic
      textShadow: `0 0 4px ${baseColor}, 0 0 12px ${baseColor}`,
      whiteSpace: char === ' ' ? 'pre' : 'normal',
      minWidth: char === ' ' ? '0.3em' : 'auto',
      transition: 'color 0.15s ease, text-shadow 0.15s ease',
      fontStyle: 'normal',
      textTransform: 'uppercase',
    };

    switch (currentAnimation.name) {
      case 'typewriter':
        return {
          ...base,
          opacity: 0,
          animation: `typewriterReveal 0.1s ease forwards`,
          animationDelay: `${index * 0.08}s`,
        };

      case 'wave':
        return {
          ...base,
          animation: `waveFloat 0.6s ease-in-out infinite`,
          animationDelay: `${delay}s`,
        };

      case 'jiggle':
        return {
          ...base,
          animation: `jiggleShake 0.15s ease-in-out infinite`,
          animationDelay: `${delay}s`,
        };

      case 'flyInLeft':
        return {
          ...base,
          animation: `flyFromLeft 0.5s ease-out forwards`,
          animationDelay: `${delay}s`,
          opacity: 0,
        };

      case 'flyInRight':
        return {
          ...base,
          animation: `flyFromRight 0.5s ease-out forwards`,
          animationDelay: `${delay}s`,
          opacity: 0,
        };

      case 'flyInTop':
        return {
          ...base,
          animation: `flyFromTop 0.5s ease-out forwards`,
          animationDelay: `${delay}s`,
          opacity: 0,
        };

      case 'flyInBottom':
        return {
          ...base,
          animation: `flyFromBottom 0.5s ease-out forwards`,
          animationDelay: `${delay}s`,
          opacity: 0,
        };

      case 'bounceIn':
        return {
          ...base,
          animation: `bounceInEffect 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55) forwards`,
          animationDelay: `${delay}s`,
          opacity: 0,
          transform: 'scale(0)',
        };

      case 'glitch':
        return {
          ...base,
          animation: `glitchEffect 0.3s ease-in-out infinite`,
          animationDelay: `${Math.random() * 0.5}s`,
        };

      case 'scramble':
        return {
          ...base,
          animation: `scrambleEffect 0.5s ease-out forwards`,
          animationDelay: `${delay * 2}s`,
        };

      case 'rubberBand':
        return {
          ...base,
          animation: `rubberBandEffect 1s ease-in-out infinite`,
          animationDelay: `${delay}s`,
        };

      case 'flip3D':
        return {
          ...base,
          animation: `flip3DEffect 0.8s ease-in-out forwards`,
          animationDelay: `${delay}s`,
          transformStyle: 'preserve-3d',
        };

      case 'neonFlicker':
        return {
          ...base,
          animation: `neonFlickerEffect 0.5s ease-in-out infinite`,
          animationDelay: `${Math.random() * 2}s`,
        };

      case 'explode':
        return {
          ...base,
          animation: `explodeEffect 1.5s ease-out forwards`,
          animationDelay: `${delay}s`,
        };

      case 'swing':
        return {
          ...base,
          animation: `swingEffect 1s ease-in-out infinite`,
          animationDelay: `${delay}s`,
          transformOrigin: 'top center',
        };

      case 'zoomPulse':
        return {
          ...base,
          animation: `zoomPulseEffect 0.8s ease-in-out infinite`,
          animationDelay: `${delay}s`,
        };

      case 'spiral':
        return {
          ...base,
          animation: `spiralInEffect 1s ease-out forwards`,
          animationDelay: `${delay}s`,
          opacity: 0,
        };

      case 'matrix':
        return {
          ...base,
          color: '#39ff14',
          textShadow: '0 0 5px #39ff14, 0 0 10px #39ff14, 0 0 20px #39ff14, 0 0 40px #39ff14',
          animation: `matrixFall 0.8s ease-out forwards`,
          animationDelay: `${Math.random() * 1}s`,
          opacity: 0,
        };

      case 'disco':
        return {
          ...base,
          animation: `discoFlash 0.2s ease-in-out infinite`,
          animationDelay: `${index * 0.1}s`,
        };

      case 'earthquake':
        return {
          ...base,
          animation: `earthquakeShake 0.1s ease-in-out infinite`,
          animationDelay: `${Math.random() * 0.1}s`,
        };

      case 'slot':
        return {
          ...base,
          animation: `slotMachine 0.8s ease-out forwards`,
          animationDelay: `${index * 0.1}s`,
          opacity: 0,
        };

      case 'bounce':
        return {
          ...base,
          animation: `superBounce 0.5s ease-in-out infinite`,
          animationDelay: `${delay}s`,
        };

      case 'rainbow':
        return {
          ...base,
          animation: `rainbowCycle 2s linear infinite, gentleFloat 1s ease-in-out infinite`,
          animationDelay: `${delay}s`,
        };

      default:
        return base;
    }
  };

  return (
    <div key={key} className="text-2xl mb-10 font-bold tracking-wide uppercase" style={{ minHeight: '2em', perspective: '1000px', fontFamily: 'inherit' }}>
      {TAGLINE.split('').map((char, index) => (
        <span key={index} style={getLetterStyle(index, char)}>
          {char}
        </span>
      ))}
    </div>
  );
}

const animationStyles = `
  @keyframes typewriterReveal {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes waveFloat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-15px); }
  }

  @keyframes jiggleShake {
    0%, 100% { transform: translateX(0) rotate(0deg); }
    25% { transform: translateX(-3px) rotate(-5deg); }
    50% { transform: translateX(3px) rotate(5deg); }
    75% { transform: translateX(-3px) rotate(-5deg); }
  }

  @keyframes flyFromLeft {
    from { opacity: 0; transform: translateX(-100px) rotate(-180deg); }
    to { opacity: 1; transform: translateX(0) rotate(0deg); }
  }

  @keyframes flyFromRight {
    from { opacity: 0; transform: translateX(100px) rotate(180deg); }
    to { opacity: 1; transform: translateX(0) rotate(0deg); }
  }

  @keyframes flyFromTop {
    from { opacity: 0; transform: translateY(-100px) scale(0); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @keyframes flyFromBottom {
    from { opacity: 0; transform: translateY(100px) scale(2); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @keyframes bounceInEffect {
    0% { opacity: 0; transform: scale(0); }
    50% { transform: scale(1.3); }
    70% { transform: scale(0.9); }
    100% { opacity: 1; transform: scale(1); }
  }

  @keyframes glitchEffect {
    0%, 100% { transform: translate(0); filter: hue-rotate(0deg); }
    20% { transform: translate(-3px, 3px); filter: hue-rotate(90deg); }
    40% { transform: translate(3px, -3px); filter: hue-rotate(180deg); }
    60% { transform: translate(-3px, -3px); filter: hue-rotate(270deg); }
    80% { transform: translate(3px, 3px); filter: hue-rotate(360deg); }
  }

  @keyframes scrambleEffect {
    0% { transform: translateY(-50px) rotate(720deg); opacity: 0; }
    100% { transform: translateY(0) rotate(0deg); opacity: 1; }
  }

  @keyframes rubberBandEffect {
    0%, 100% { transform: scaleX(1); }
    30% { transform: scaleX(1.25); }
    40% { transform: scaleX(0.75); }
    50% { transform: scaleX(1.15); }
    65% { transform: scaleX(0.95); }
    75% { transform: scaleX(1.05); }
  }

  @keyframes flip3DEffect {
    0% { transform: rotateY(0deg); }
    50% { transform: rotateY(180deg); }
    100% { transform: rotateY(360deg); }
  }

  @keyframes neonFlickerEffect {
    0%, 19%, 21%, 23%, 25%, 54%, 56%, 100% {
      opacity: 1;
      text-shadow: 0 0 10px currentColor, 0 0 20px currentColor, 0 0 40px currentColor, 0 0 80px currentColor;
    }
    20%, 24%, 55% {
      opacity: 0.4;
      text-shadow: none;
    }
  }

  @keyframes explodeEffect {
    0% { transform: translate(0) scale(1) rotate(0deg); opacity: 1; }
    30% { transform: translate(var(--explode-x, 50px), var(--explode-y, -50px)) scale(0) rotate(720deg); opacity: 0; }
    31% { transform: translate(0) scale(0) rotate(0deg); opacity: 0; }
    100% { transform: translate(0) scale(1) rotate(0deg); opacity: 1; }
  }

  @keyframes swingEffect {
    0%, 100% { transform: rotate(0deg); }
    20% { transform: rotate(15deg); }
    40% { transform: rotate(-10deg); }
    60% { transform: rotate(5deg); }
    80% { transform: rotate(-5deg); }
  }

  @keyframes zoomPulseEffect {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.4); }
  }

  @keyframes spiralInEffect {
    0% { opacity: 0; transform: rotate(720deg) scale(0) translateY(-100px); }
    100% { opacity: 1; transform: rotate(0deg) scale(1) translateY(0); }
  }

  @keyframes matrixFall {
    0% { opacity: 0; transform: translateY(-200px); }
    60% { opacity: 1; }
    100% { opacity: 1; transform: translateY(0); }
  }

  @keyframes discoFlash {
    0% { filter: hue-rotate(0deg) brightness(1); transform: scale(1); }
    50% { filter: hue-rotate(180deg) brightness(1.5); transform: scale(1.1); }
    100% { filter: hue-rotate(360deg) brightness(1); transform: scale(1); }
  }

  @keyframes earthquakeShake {
    0%, 100% { transform: translate(0, 0) rotate(0deg); }
    10% { transform: translate(-5px, -5px) rotate(-1deg); }
    20% { transform: translate(5px, 5px) rotate(1deg); }
    30% { transform: translate(-5px, 5px) rotate(0deg); }
    40% { transform: translate(5px, -5px) rotate(1deg); }
    50% { transform: translate(-5px, 0) rotate(-1deg); }
    60% { transform: translate(5px, 0) rotate(0deg); }
    70% { transform: translate(0, -5px) rotate(-1deg); }
    80% { transform: translate(0, 5px) rotate(1deg); }
    90% { transform: translate(-3px, -3px) rotate(0deg); }
  }

  @keyframes slotMachine {
    0% { opacity: 0; transform: translateY(-500px); }
    70% { transform: translateY(10px); }
    85% { transform: translateY(-5px); }
    100% { opacity: 1; transform: translateY(0); }
  }

  @keyframes superBounce {
    0%, 100% { transform: translateY(0) scaleY(1); }
    30% { transform: translateY(-25px) scaleY(1.1); }
    50% { transform: translateY(0) scaleY(0.9) scaleX(1.1); }
    65% { transform: translateY(-10px) scaleY(1); }
    80% { transform: translateY(0) scaleY(0.95) scaleX(1.05); }
  }

  @keyframes rainbowCycle {
    0% { filter: hue-rotate(0deg); }
    100% { filter: hue-rotate(360deg); }
  }

  @keyframes gentleFloat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
  }
`;

export function Home() {
  return (
    <div className="min-h-screen relative bg-black">
      <style>{animationStyles}</style>

      {/* Centered login content */}
      <div className="absolute inset-0 flex items-center justify-center px-6 z-[100]">
        <div className="text-center">
          <img
            src="/ape-logo.png"
            alt="APE YOLO Logo"
            className="w-[450px] h-[450px] mx-auto mb-2 object-contain"
          />
          <h1 className="text-7xl md:text-8xl font-bold mb-5 tracking-wide" data-testid="text-hero-title">
            APE YOLO
          </h1>
          <p className="text-3xl md:text-4xl text-white mb-8 tracking-wide" data-testid="text-hero-tagline">
            THE SAFEST WAY TO YOLO
          </p>

          <div className="mt-6">
            <WildTagline />
          </div>

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
