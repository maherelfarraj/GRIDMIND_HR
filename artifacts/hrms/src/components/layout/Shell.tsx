import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export function Shell({ children }: { children: React.ReactNode }) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground transition-colors duration-200">
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      <Sidebar 
        isMobileOpen={isMobileOpen} 
        onMobileClose={() => setIsMobileOpen(false)} 
      />
      
      <div className="flex-1 flex flex-col min-w-0">
        <Header onMenuClick={() => setIsMobileOpen(true)} />
        <main className="flex-1 overflow-x-hidden p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
