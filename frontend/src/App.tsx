import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { useAuthStore } from './stores/auth';
import { checkAppUpdate } from './lib/appUpdate';
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
import Members from './pages/Members';
import LedgerManage from './pages/LedgerManage';
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
  const navigate = useNavigate();
  const location = useLocation();

  // Android 返回键：栈里有上一页则后退，首页/登录页则退出 App
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handler = CapacitorApp.addListener('backButton', () => {
      const path = location.pathname;
      if (path === '/ledgers' || path === '/login') {
        CapacitorApp.exitApp();
      } else {
        navigate(-1);
      }
    });
    return () => {
      handler.then((h) => h.remove());
    };
  }, [location.pathname, navigate]);

  // 启动时检查 App 更新（网页端自动跳过）
  useEffect(() => {
    checkAppUpdate();
  }, []);

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
        <Route path="ledgers/:id/members" element={<Members />} />
        <Route path="ledgers/:id/loans" element={<Loans />} />
        <Route path="ledgers/:ledgerId/loans/new" element={<LoanForm />} />
        <Route path="loans/:id" element={<LoanDetail />} />
        <Route path="loans/:id/edit" element={<LoanForm />} />
        <Route path="repayments" element={<Repayments />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="stats" element={<Stats />} />
        <Route path="settings" element={<Settings />} />
        <Route path="settings/ledgers" element={<LedgerManage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
