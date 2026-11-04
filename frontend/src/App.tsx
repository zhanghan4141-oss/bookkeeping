import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/auth';
import Login from './pages/Login';
import Ledgers from './pages/Ledgers';
import LedgerDetail from './pages/LedgerDetail';
import TransactionForm from './pages/TransactionForm';
import Categories from './pages/Categories';
import Loans from './pages/Loans';
import LoanDetail from './pages/LoanDetail';
import LoanForm from './pages/LoanForm';
import Repayments from './pages/Repayments';
import Notifications from './pages/Notifications';
import Stats from './pages/Stats';
import Settings from './pages/Settings';
import TabBar from './components/TabBar';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuthStore();
  const location = useLocation();
  if (!accessToken) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <TabBar />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/ledgers" replace />} />
        <Route path="ledgers" element={<Ledgers />} />
        <Route path="ledgers/:id" element={<LedgerDetail />} />
        <Route path="ledgers/:id/record" element={<TransactionForm />} />
        <Route path="ledgers/:id/categories" element={<Categories />} />
        <Route path="ledgers/:id/loans" element={<Loans />} />
        <Route path="ledgers/:id/loans/new" element={<LoanForm />} />
        <Route path="loans/:id" element={<LoanDetail />} />
        <Route path="loans/:id/edit" element={<LoanForm />} />
        <Route path="repayments" element={<Repayments />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="stats" element={<Stats />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
