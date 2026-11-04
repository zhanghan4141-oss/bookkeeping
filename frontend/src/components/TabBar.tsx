import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { TabBar as AntdTabBar } from 'antd-mobile';
import {
  AppOutline,
  PayCircleOutline,
  HistogramOutline,
  UserOutline,
} from 'antd-mobile-icons';

const tabs = [
  { key: '/ledgers', title: '账本', icon: <AppOutline /> },
  { key: '/repayments', title: '还款', icon: <PayCircleOutline /> },
  { key: '/stats', title: '统计', icon: <HistogramOutline /> },
  { key: '/settings', title: '我的', icon: <UserOutline /> },
];

export default function TabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const current = tabs.find((t) => location.pathname.startsWith(t.key))?.key ?? '/ledgers';

  return (
    <>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <Outlet />
      </div>
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: '#fff',
          borderTop: '1px solid #eee',
          zIndex: 100,
        }}
      >
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <AntdTabBar activeKey={current} onChange={(key) => navigate(key)}>
            {tabs.map((t) => (
              <AntdTabBar.Item key={t.key} icon={t.icon} title={t.title} />
            ))}
          </AntdTabBar>
        </div>
      </div>
    </>
  );
}
