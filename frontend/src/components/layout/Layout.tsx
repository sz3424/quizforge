import React, { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Menu, X } from 'lucide-react';

/**
 * App shell: fixed desktop sidebar (240px) + 68px header on mobile,
 * with the routed page rendered inside the remaining content area.
 */
export const Layout: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Mobile header */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-sidebar px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setIsSidebarOpen((open) => !open)}
          className="rounded-md p-2 text-content-secondary transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={isSidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={isSidebarOpen}
          aria-controls="mobile-navigation"
        >
          {isSidebarOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
        <span className="text-[15px] font-semibold tracking-tight">QUIZFORGE</span>
        <span className="w-9" aria-hidden="true" />
      </header>

      {/* Mobile drawer */}
      {isSidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/60 lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
          <div
            id="mobile-navigation"
            className="fixed inset-y-0 left-0 z-40 w-64 border-r border-border lg:hidden"
          >
            <Sidebar />
          </div>
        </>
      )}

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 border-r border-border lg:block">
        <Sidebar />
      </aside>

      {/* Main content */}
      <main className="lg:pl-60">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};