import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { useAuthStore } from './stores/auth';
import { useThemeStore } from './stores/themeStore';
import { checkAppUpdate } from './lib/appUpdate';
import { applyTheme } from './lib/applyTheme';
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
  const themeColor = useThemeStore((s) => s.themeColor);
  const darkMode = useThemeStore((s) => s.darkMode);

  // 主题变化时应用（切换主题色 / 深色模式）
  useEffect(() => {
    applyTheme({ themeColor, darkMode });
  }, [themeColor, darkMode]);

  // Android 返回键：退页面（navigate(-1) 触发 popstate，由下方 onPop 按 __overlay 判断关弹窗/退页面）
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handler = CapacitorApp.addListener('backButton', () => {
      const path = location.pathname;
      if (path === '/ledgers' || path === '/login') {
        // 首页/登录页：有弹窗先关，无弹窗退出 App
        if (closeTopOverlay()) return;
        CapacitorApp.exitApp();
        return;
      }
      navigate(-1);
    });
    return () => {
      handler.then((h) => h.remove());
    };
  }, [location.pathname, navigate]);

  // 浏览器/系统返回（popstate）：按 history state 判断关弹窗 or 退页面（web 与 App 原生共用）
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      // 退到「弹窗占位」(__overlay) = 返回页面、弹窗保留（React Router 已导航回弹窗所在页）；
      // 退到普通条目 = 从占位退回 → 关闭栈顶弹窗（栈空时无害，浏览器自然后退）。
      if (!e.state?.__overlay) {
        closeTopOverlay();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

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
