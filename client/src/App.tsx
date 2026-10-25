import type { ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import { useAuthStore } from '@/store/auth';
import Auth from '@/pages/Auth';
import Dashboard from '@/pages/Dashboard';
import Payments from '@/pages/Payments';
import History from '@/pages/History';
import OperationDetails from '@/pages/OperationDetails';
import Support from '@/pages/Support';
import Sandbox from '@/pages/Sandbox';
import Calendar from '@/pages/Calendar';
import BankStub from '@/pages/BankStub';

function Protected({ children }: { children: ReactElement }) {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  if (!token) {
    return <Navigate to="/auth" replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}

export default function App() {
  const token = useAuthStore((s) => s.token);
  return (
    <Routes>
      <Route path="/auth" element={token ? <Navigate to="/" replace /> : <Auth />} />
      <Route element={<Protected><AppLayout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="payments" element={<Payments />} />
        <Route path="history" element={<History />} />
        <Route path="history/:id" element={<OperationDetails />} />
        <Route path="support" element={<Support />} />
        <Route path="sandbox" element={<Sandbox />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="bank-stub" element={<BankStub />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
