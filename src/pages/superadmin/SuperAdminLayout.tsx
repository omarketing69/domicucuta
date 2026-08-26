import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LayoutDashboard, Building2, LogOut, Shield, DollarSign } from 'lucide-react';
import logo from '@/assets/logo.png';
import { cn } from '@/lib/utils';

const navItems = [
  { title: 'Dashboard', url: '/superadmin', icon: LayoutDashboard, end: true },
  { title: 'Negocios', url: '/superadmin/businesses', icon: Building2, end: false },
  { title: 'Precios de planes', url: '/superadmin/pricing', icon: DollarSign, end: false },
];

export default function SuperAdminLayout() {
  const { signOut } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <img src={logo} alt="WhatOrden" className="w-8 h-8" />
          <div>
            <p className="text-xs font-semibold tracking-tight">WhatOrden</p>
            <div className="flex items-center gap-1 mt-0.5">
              <Shield className="w-3 h-3 text-destructive" />
              <span className="text-[10px] text-destructive font-medium">Super Admin</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map(item => {
            const active = item.end
              ? location.pathname === item.url
              : location.pathname.startsWith(item.url);
            return (
              <Link
                key={item.url}
                to={item.url}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                  active
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <item.icon className="w-4 h-4 flex-shrink-0" />
                {item.title}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-border">
          <button
            onClick={signOut}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors w-full"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
