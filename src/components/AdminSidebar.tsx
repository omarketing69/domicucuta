import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useBusiness } from '@/hooks/useBusiness';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader,
  SidebarFooter, useSidebar,
} from '@/components/ui/sidebar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { NavLink } from '@/components/NavLink';
import {
  LayoutDashboard, Package, FolderOpen, ShoppingBag, Settings,
  ExternalLink, LogOut, ChefHat, Flame, Bot, UtensilsCrossed, ChevronDown, TrendingUp,
  CalendarDays, Scissors,
} from 'lucide-react';
import { PlanBadge } from './PlanBadge';
import { hasCrmAccess } from '@/lib/sso';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';

interface NavItem {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  accent?: {
    idle: string;
    active: string;
    icon: string;
  };
}

const menuItems: NavItem[] = [
  { title: 'Categorías', url: '/admin/categories', icon: FolderOpen },
  { title: 'Toppings',   url: '/admin/toppings',   icon: ChefHat },
  { title: 'Sabores',    url: '/admin/flavors',    icon: Flame },
  { title: 'Productos',  url: '/admin/products',   icon: Package },
];

const ordersItem: NavItem = {
  title: 'Pedidos',
  url: '/admin/orders',
  icon: ShoppingBag,
  accent: {
    idle:   'hover:bg-amber-50 dark:hover:bg-amber-950/30 text-amber-700 dark:text-amber-400',
    active: 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 font-semibold',
    icon:   'bg-amber-500 text-white shadow-sm shadow-amber-200 dark:shadow-amber-900',
  },
};

const bottomItems: NavItem[] = [
  { title: 'Configuración', url: '/admin/settings', icon: Settings },
];

function NavItemRow({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  if (item.accent) {
    return (
      <NavLink
        to={item.url}
        className={cn(
          'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors',
          item.accent.idle
        )}
        activeClassName={item.accent.active}
      >
        <span className={cn(
          'w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0',
          item.accent.icon
        )}>
          <item.icon className="w-3.5 h-3.5" />
        </span>
        {!collapsed && <span>{item.title}</span>}
      </NavLink>
    );
  }
  return (
    <NavLink
      to={item.url}
      end={item.url === '/admin/dashboard'}
      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
    >
      <item.icon className="w-4 h-4 flex-shrink-0" />
      {!collapsed && <span>{item.title}</span>}
    </NavLink>
  );
}

export function AdminSidebar() {
  const { signOut } = useAuth();
  const { business } = useBusiness();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  const [menuOpen, setMenuOpen] = useState<boolean>(
    () => localStorage.getItem('sidebarMenuOpen') !== 'false'
  );

  const isPro = hasCrmAccess(business ?? undefined);
  const isReservations = (business as any)?.business_type === 'reservations';

  const handleMenuToggle = (open: boolean) => {
    setMenuOpen(open);
    localStorage.setItem('sidebarMenuOpen', String(open));
  };

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b border-sidebar-border p-4">
          <div className="flex items-center gap-2">
            <img src={logo} alt="DomiCircusPop" className="w-8 h-8 flex-shrink-0" />
            {!collapsed && <span className="font-semibold text-sm tracking-tight">DomiCircusPop</span>}
          </div>
        </SidebarHeader>

        <SidebarContent className="p-2">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>

                {/* Dashboard */}
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavItemRow
                      item={{ title: 'Dashboard', url: '/admin/dashboard', icon: LayoutDashboard }}
                      collapsed={collapsed}
                    />
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {/* ── Catalog / Services group ──────────────────────────── */}
                {isReservations ? (
                  /* Reservations mode: single "Servicios" item */
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavItemRow
                        item={{ title: 'Servicios', url: '/admin/servicios', icon: Scissors }}
                        collapsed={collapsed}
                      />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : collapsed ? (
                  // Products mode, icon-only: show items flat
                  menuItems.map(item => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild>
                        <NavItemRow item={item} collapsed={true} />
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))
                ) : (
                  // Products mode, expanded: collapsible group
                  <Collapsible open={menuOpen} onOpenChange={handleMenuToggle}>
                    <CollapsibleTrigger asChild>
                      <button
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors w-full"
                        data-testid="btn-crear-menu-toggle"
                      >
                        <UtensilsCrossed className="w-4 h-4 flex-shrink-0" />
                        <span className="flex-1 text-left">Crear menú</span>
                        <ChevronDown className={cn(
                          'w-3.5 h-3.5 text-muted-foreground transition-transform duration-200',
                          menuOpen && 'rotate-180'
                        )} />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="ml-3 pl-3 border-l border-sidebar-border space-y-0.5 mt-0.5 mb-1">
                        {menuItems.map(item => (
                          <SidebarMenuItem key={item.url}>
                            <SidebarMenuButton asChild>
                              <NavItemRow item={item} collapsed={false} />
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {/* Pedidos / Agenda */}
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    {isReservations ? (
                      <NavItemRow
                        item={{
                          title: 'Reservas',
                          url: '/admin/agenda',
                          icon: CalendarDays,
                          accent: {
                            idle:   'hover:bg-violet-50 dark:hover:bg-violet-950/30 text-violet-700 dark:text-violet-400',
                            active: 'bg-violet-100 dark:bg-violet-950/50 text-violet-800 dark:text-violet-300 font-semibold',
                            icon:   'bg-violet-500 text-white shadow-sm shadow-violet-200 dark:shadow-violet-900',
                          },
                        }}
                        collapsed={collapsed}
                      />
                    ) : (
                      <NavItemRow item={ordersItem} collapsed={collapsed} />
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {/* Agente IA — visible for all plans */}
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to="/admin/agente-ia"
                      data-testid="link-agente-ia-nav"
                      className={cn(
                        'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors w-full',
                        'hover:bg-violet-50 dark:hover:bg-violet-950/30 text-violet-700 dark:text-violet-400'
                      )}
                      activeClassName="bg-violet-100 dark:bg-violet-950/50 text-violet-800 dark:text-violet-300 font-medium"
                    >
                      <span className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 bg-violet-500 text-white shadow-sm shadow-violet-200 dark:shadow-violet-900">
                        <Bot className="w-3.5 h-3.5" />
                      </span>
                      {!collapsed && <span>Agente IA</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {/* Director de Ventas IA — visible for all plans */}
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to="/admin/director-ventas"
                      data-testid="link-director-ventas-nav"
                      className={cn(
                        'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors w-full',
                        'hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                      )}
                      activeClassName="bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 font-medium"
                    >
                      <span className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 bg-emerald-500 text-white shadow-sm shadow-emerald-200 dark:shadow-emerald-900">
                        <TrendingUp className="w-3.5 h-3.5" />
                      </span>
                      {!collapsed && <span>Director de Ventas IA</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {/* CRM — Pro only */}
                {isPro && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to="/admin/crm"
                        data-testid="link-crm-nav"
                        className={cn(
                          'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors w-full',
                          'hover:bg-sky-50 dark:hover:bg-sky-950/30 text-sky-700 dark:text-sky-400'
                        )}
                        activeClassName="bg-sky-100 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 font-medium"
                      >
                        <span className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 bg-sky-500 text-white shadow-sm shadow-sky-200 dark:shadow-sky-900">
                          <Bot className="w-3.5 h-3.5" />
                        </span>
                        {!collapsed && <span>CRM Inteligente</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}

                {/* Configuración */}
                {bottomItems.map(item => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild>
                      <NavItemRow item={item} collapsed={collapsed} />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}

              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="p-3 border-t border-sidebar-border space-y-2">
          <PlanBadge collapsed={collapsed} />
          {business && !collapsed && (
            <Link
              to={`/b/${business.slug}`}
              target="_blank"
              className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            >
              <ExternalLink className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{isReservations ? 'Ver página' : 'Ver menú'}</span>
            </Link>
          )}
          <button
            onClick={signOut}
            className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors w-full"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>Cerrar sesión</span>}
          </button>
        </SidebarFooter>
      </Sidebar>
    </>
  );
}
