import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  Gauge, 
  TrendingUp, 
  Briefcase, 
  Settings, 
  History 
} from "lucide-react";

const navItems = [
  { path: '/', label: 'Dashboard', icon: Gauge },
  { path: '/trade', label: 'Trade', icon: TrendingUp },
  { path: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { path: '/rules', label: 'Rules', icon: Settings },
  { path: '/logs', label: 'Logs', icon: History },
];

export default function MainNavigation() {
  const [location, setLocation] = useLocation();

  const handleNavClick = (path: string) => {
    setLocation(path);
  };

  return (
    <nav className="bg-card border-b border-border px-6">
      <div className="flex space-x-8">
        {navItems.map(({ path, label, icon: Icon }) => {
          const isActive = location === path;
          return (
            <button
              key={path}
              onClick={() => handleNavClick(path)}
              className={cn(
                "nav-tab px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center space-x-2",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
              data-testid={`nav-${label.toLowerCase()}`}
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
