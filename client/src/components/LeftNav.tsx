import { Link, useLocation } from 'wouter';
import { Terminal, BarChart2 } from 'lucide-react';

const navItems = [
  { path: '/terminal', label: 'Terminal', icon: Terminal },
  { path: '/dd', label: 'DD', icon: BarChart2 },
];

export function LeftNav() {
  const [location] = useLocation();

  return (
    <div className="w-20 bg-charcoal border-r border-white/10 flex flex-col items-center py-6 space-y-2">
      {navItems.map((item) => {
        const Icon = item.icon;
        // Handle active state for routes with query params (e.g., /review?tab=...)
        const isActive = location.startsWith(item.path);
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
