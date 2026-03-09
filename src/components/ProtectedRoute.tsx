import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  requireAdmin?: boolean;
}

export default function ProtectedRoute({ requireAdmin = false }: ProtectedRouteProps) {
  const { user, loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Super admins must use their own interface, not the business panel
  if (!requireAdmin && isAdmin) return <Navigate to="/superadmin" replace />;

  // Non-admins cannot access super admin routes
  if (requireAdmin && !isAdmin) return <Navigate to="/admin/dashboard" replace />;

  return <Outlet />;
}
