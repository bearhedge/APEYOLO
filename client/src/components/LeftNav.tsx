import { Link, useLocation } from 'wouter';
import { Bot, Briefcase, BarChart2, List, Settings, Zap, Trophy, Coins } from 'lucide-react';

const navItems = [
  { path: '/agent', label: 'Agent', icon: Bot },         // Primary interface
  { path: '/defi', label: 'DeFi', icon: Coins },
  { path: '/jobs', label: 'Jobs', icon: List },
  { path: '/engine', label: 'Engine', icon: Zap },
  { path: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { path: '/track-record', label: 'Track', icon: Trophy },
  { path: '/data', label: 'Data', icon: BarChart2 },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export function LeftNav() {
  const [location] = useLocation();

  return (
    <div className="w-20 bg-charcoal border-r border-white/10 flex flex-col items-center py-6 space-y-2">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = location === item.path;
        return (
          <Link
            key={item.path}
            href={item.path}
            className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg transition-colors box-border outline-none ${
              isActive
                ? 'bg-white text-black'
                : 'text-silver hover:text-white hover:bg-dark-gray'
            }`}
            data-testid={`leftnav-${item.label.toLowerCase()}`}
            title={item.label}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px] mt-1 font-medium">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
