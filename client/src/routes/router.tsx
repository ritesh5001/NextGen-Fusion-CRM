import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute, RoleRoute } from './guards';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { TelecallersPage } from '@/pages/TelecallersPage';
import { ContactsPage } from '@/pages/ContactsPage';
import { LeadsPage } from '@/pages/LeadsPage';
import { TasksPage } from '@/pages/TasksPage';
import { FollowUpsPage } from '@/pages/FollowUpsPage';
import { IntegrationsPage } from '@/pages/IntegrationsPage';
import { RecentsPage } from '@/pages/RecentsPage';
import { DeviceTestPage } from '@/pages/DeviceTestPage';
import { DialerPage } from '@/pages/DialerPage';

/** Redirects the legacy /tasks/:id notification link onto the Tasks page's detail view. */
function TaskDeepLink() {
  const { id } = useParams();
  return <Navigate to={`/tasks?task=${id}`} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route
          path="/telecallers"
          element={
            <RoleRoute role="superadmin">
              <TelecallersPage />
            </RoleRoute>
          }
        />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        {/* Older task notifications linked to /tasks/:id — keep them working. */}
        <Route path="/tasks/:id" element={<TaskDeepLink />} />
        <Route path="/followups" element={<FollowUpsPage />} />
        <Route path="/recents" element={<RecentsPage />} />
        <Route path="/dialer" element={<DialerPage />} />
        <Route path="/device-test" element={<DeviceTestPage />} />
        <Route
          path="/integrations"
          element={
            <RoleRoute role="superadmin">
              <IntegrationsPage />
            </RoleRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
