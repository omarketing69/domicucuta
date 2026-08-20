import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminLayout from "@/pages/admin/AdminLayout";
import Dashboard from "@/pages/admin/Dashboard";
import Products from "@/pages/admin/Products";
import Categories from "@/pages/admin/Categories";
import Orders from "@/pages/admin/Orders";
import Servicios from "@/pages/admin/Servicios";
import Agenda from "@/pages/admin/Agenda";
import Customers from "@/pages/admin/Customers";
import Settings from "@/pages/admin/Settings";
import Toppings from "@/pages/admin/Toppings";
import Flavors from "@/pages/admin/Flavors";
import Crm from "@/pages/admin/Crm";
import CrmIntelligente from "@/pages/admin/CrmIntelligente";
import AgenteIA from "@/pages/admin/AgenteIA";
import DirectorVentas from "@/pages/admin/DirectorVentas";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Onboarding from "@/pages/Onboarding";
import PublicMenu from "@/pages/PublicMenu";
import Tracking from "@/pages/Tracking";
import Pricing from "@/pages/Pricing";
import NotFound from "@/pages/NotFound";
import SuperAdminLayout from "@/pages/superadmin/SuperAdminLayout";
import SuperAdminDashboard from "@/pages/superadmin/SuperAdminDashboard";
import SuperAdminBusinesses from "@/pages/superadmin/SuperAdminBusinesses";
import SuperAdminPricing from "@/pages/superadmin/SuperAdminPricing";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<Navigate to="/pricing" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/b/:slug" element={<PublicMenu />} />
            <Route path="/tracking/:code" element={<Tracking />} />

            {/* Protected admin routes */}
            <Route element={<ProtectedRoute />}>
              <Route path="/admin/onboarding" element={<Onboarding />} />
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="/admin/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="products" element={<Products />} />
                <Route path="toppings" element={<Toppings />} />
                <Route path="flavors" element={<Flavors />} />
                <Route path="categories" element={<Categories />} />
                <Route path="orders" element={<Orders />} />
                <Route path="servicios" element={<Servicios />} />
                <Route path="agenda" element={<Agenda />} />
                <Route path="customers" element={<Customers />} />
                <Route path="crm" element={<CrmIntelligente />} />
                <Route path="crm-clasico" element={<Crm />} />
                <Route path="agente-ia" element={<AgenteIA />} />
                <Route path="director-ventas" element={<DirectorVentas />} />
                <Route path="settings" element={<Settings />} />
              </Route>
            </Route>

            {/* Super Admin routes */}
            <Route element={<ProtectedRoute requireAdmin />}>
              <Route path="/superadmin" element={<SuperAdminLayout />}>
                <Route index element={<SuperAdminDashboard />} />
                <Route path="businesses" element={<SuperAdminBusinesses />} />
                <Route path="pricing" element={<SuperAdminPricing />} />
              </Route>
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
