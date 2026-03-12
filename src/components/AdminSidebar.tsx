import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useBusiness } from '@/hooks/useBusiness';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader,
  SidebarFooter, useSidebar,
} from '@/components/ui/sidebar';
import { NavLink } from '@/components/NavLink';
import {
  LayoutDashboard, Package, FolderOpen, ShoppingBag, Settings,
  ExternalLink, LogOut, ChefHat
} from 'lucide-react';
import { PlanBadge } from './PlanBadge';
import logo from '@/assets/logo.png';

const navItems = [
  { title: 'Dashboard', url: '/admin/dashboard', icon: LayoutDashboard },
  { title: 'Productos', url: '/admin/products', icon: Package },
  { title: 'Toppings', url: '/admin/toppings', icon: ChefHat },
  { title: 'Categorías', url: '/admin/categories', icon: FolderOpen },
  { title: 'Pedidos', url: '/admin/orders', icon: ShoppingBag },
  { title: 'Configuración', url: '/admin/settings', icon: Settings },
];

export function AdminSidebar() {
  const { signOut } = useAuth();
  const { business } = useBusiness();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  return (
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
              {navItems.map(item => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === '/admin/dashboard'}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <item.icon className="w-4 h-4 flex-shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
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
            <span className="truncate">Ver menú</span>
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
  );
}
