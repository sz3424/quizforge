import { NavLink } from 'react-router-dom';
import { useTheme } from '@/hooks/useTheme';
import { useHealth } from '@/hooks/useHealth';
import { cn } from '@/utils/cn';
import {
  LayoutDashboard,
  FilePlus2,
  Library,
  History,
  BarChart3,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { ElementType } from 'react';

interface NavItem {
  label: string;
  to: string;
  icon: ElementType;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, end: true },
  { label: 'Create Quiz', to: '/create', icon: FilePlus2 },
  { label: 'My Quizzes', to: '/quizzes', icon: Library },
  { label: 'History', to: '/history', icon: History },
  { label: 'Analytics', to: '/analytics', icon: BarChart3 },
  { label: 'Settings', to: '/settings', icon: SettingsIcon },
];

const APP_VERSION = '1.0.0';

export const Sidebar = () => {
  const { resolvedTheme } = useTheme();
  const { status } = useHealth();

  const statusLabel =
    status === 'online'
      ? 'Backend: Connected'
      : status === 'checking'
        ? 'Backend: Checking…'
        : 'Backend: Offline';

  const statusDot =
    status === 'online' ? 'bg-success' : status === 'checking' ? 'bg-warning' : 'bg-destructive';

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-[68px] shrink-0 items-center gap-2 border-b border-border px-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          QF
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-foreground">QUIZFORGE</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      isActive
                        ? 'bg-accent text-primary'
                        : 'text-content-secondary hover:bg-accent/60 hover:text-foreground'
                    )
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', statusDot)} aria-hidden="true" />
          <span className="text-xs text-content-muted">{statusLabel}</span>
        </div>
        <p className="mt-1 text-xs text-content-muted">
          v{APP_VERSION} · {resolvedTheme === 'light' ? 'Light' : 'Dark'} theme
        </p>
      </div>
    </div>
  );
};