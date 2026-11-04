import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, List, NavBar, Stepper, Switch, Toast } from 'antd-mobile';
import { settingsApi } from '../api/misc';
import { useAuthStore } from '../stores/auth';
import type { ReminderSetting } from '../types';

export default function Settings() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const { data: setting, refetch } = useQuery({
    queryKey: ['settings', 'reminder'],
    queryFn: async () => (await settingsApi.getReminder()).data as ReminderSetting,
  });

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const save = async (patch: Partial<ReminderSetting>) => {
    try {
      await settingsApi.updateReminder(patch);
      refetch();
      Toast.show({ content: '已保存' });
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '保存失败' });
    }
  };

  return (
    <div className="page">
      <NavBar back={null} style={{ background: '#fff' }}>
        我的
      </NavBar>

      <div style={{ padding: 16 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{user?.nickname}</div>
          <div className="text-secondary" style={{ fontSize: 13 }}>{user?.email}</div>
        </div>

        <div style={{ fontWeight: 600, marginBottom: 8 }}>还款提醒设置</div>
        <List style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
          <List.Item
            extra={
              <Stepper
                min={1}
                max={30}
                value={setting?.leadDays ?? 3}
                onChange={(v) => save({ leadDays: v })}
              />
            }
          >
            提前提醒天数
          </List.Item>
          <List.Item
            extra={
              <Switch
                checked={setting?.inappEnabled ?? true}
                onChange={(v) => save({ inappEnabled: v })}
              />
            }
          >
            站内提醒
          </List.Item>
          <List.Item
            extra={
              <Switch
                checked={setting?.emailEnabled ?? false}
                onChange={(v) => save({ emailEnabled: v })}
              />
            }
          >
            邮件提醒
          </List.Item>
        </List>

        {setting?.emailEnabled && (
          <List style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
            <List.Item>
              <Input
                placeholder="提醒邮箱"
                defaultValue={setting?.email ?? ''}
                onBlur={(e) => {
                  const email = e.target.value.trim();
                  if (email && email !== setting?.email) save({ email });
                }}
              />
            </List.Item>
          </List>
        )}

        <Button block color="danger" fill="outline" onClick={handleLogout}>
          退出登录
        </Button>
      </div>
    </div>
  );
}
