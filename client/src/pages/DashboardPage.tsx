import { useAuthStore } from '@/store/auth';
import { SuperadminDashboard } from '@/features/dashboard/SuperadminDashboard';
import { TelecallerDashboard } from '@/features/dashboard/TelecallerDashboard';

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  return user?.role === 'superadmin' ? <SuperadminDashboard /> : <TelecallerDashboard />;
}
