import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { useAuthStore } from './stores/auth';
import { checkAppUpdate } from './lib/appUpdate';
import { syncReminderNotifications } from './lib/reminderNotifications';
import { closeTopOverlay } from './lib/overlayStack';
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
import AuditLogs from './pages/AuditLogs';
import ExpensePlans from './pages/ExpensePlans';
import ExpensePlanDetail from './pages/ExpensePlanDetail';
import ExpensePlanForm from './pages/ExpensePlanForm';
import TabBar from './components/TabBar';
import GlobalLoading from './components/GlobalLoading';

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
  const accessToken = useAuthStore((s) => s.accessToken);

  // Android 返回键：栈里有上一页则后退，首页/登录页则退出 App
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handler = CapacitorApp.addListener('backButton', () => {
      // 有弹窗打开时，优先关闭栈顶弹窗，而不是跳页/退出
      if (closeTopOverlay()) return;
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

  // web：浏览器返回/手势优先关弹窗（App 原生用 backButton 处理）
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    const onPop = () => {
      if (closeTopOverlay()) {
        // 返回已触发：弹窗/编辑已被关闭，前进一格占位回到原页（避免真实后退离开页面）
        navigate(1);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [navigate]);

  // 启动时检查 App 更新（网页端自动跳过）
  useEffect(() => {
    checkAppUpdate();
  }, []);

  // 还款到期本地通知：登录后 + 回到前台时重排（网页端跳过）
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !accessToken) return;
    syncReminderNotifications();
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncReminderNotifications();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [accessToken]);

  return (
    <>
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
          <Route path="ledgers/:id/expense-plans" element={<ExpensePlans />} />
          <Route path="ledgers/:ledgerId/expense-plans/new" element={<ExpensePlanForm />} />
          <Route path="expense-plans/:id" element={<ExpensePlanDetail />} />
          <Route path="expense-plans/:id/edit" element={<ExpensePlanForm />} />
          <Route path="repayments" element={<Repayments />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="stats" element={<Stats />} />
          <Route path="settings" element={<Settings />} />
          <Route path="settings/ledgers" element={<LedgerManage />} />
          <Route path="settings/audit-logs" element={<AuditLogs />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <GlobalLoading />
    </>
  );
}
