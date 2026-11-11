import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, Input, List, NavBar, Popup, Stepper, Switch, Toast } from 'antd-mobile';
import api from '../api/client';
import { ledgerApi } from '../api/ledger';
import { settingsApi } from '../api/misc';
import { useAuthStore } from '../stores/auth';
import type { Ledger, ReminderSetting } from '../types';

export default function Settings() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [showExport, setShowExport] = useState(false);
  const [exportLedgerIds, setExportLedgerIds] = useState<string[]>([]);
  const [exportFormat, setExportFormat] = useState<'excel' | 'json'>('excel');

  const { data: setting, refetch } = useQuery({
    queryKey: ['settings', 'reminder'],
    queryFn: async () => (await settingsApi.getReminder()).data as ReminderSetting,
  });

  const { data: ledgers = [] } = useQuery({
    queryKey: ['ledgers'],
    queryFn: async () => (await ledgerApi.list()).data as Ledger[],
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

  const openExport = () => {
    setExportLedgerIds([]);
    setExportFormat('excel');
    setShowExport(true);
  };

  const toggleExportLedger = (id: string) => {
    setExportLedgerIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const doExport = async () => {
    if (exportLedgerIds.length === 0) {
      Toast.show({ content: '请选择要导出的账本' });
      return;
    }
    try {
      const res = await api.get('/export/all', {
        params: { ledgerIds: exportLedgerIds.join(','), format: exportFormat },
        responseType: 'blob',
      });
      const ext = exportFormat === 'json' ? 'json' : 'xlsx';
      const mime =
        exportFormat === 'json'
          ? 'application/json'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      // 明确指定 blob 类型，避免部分浏览器（尤其移动端）丢失 MIME 导致文件被识别为未知类型
      const blob = new Blob([res.data], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // 用英文文件名，避免中文导致移动端下载时后缀丢失
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const p = (n: number) => String(n).padStart(2, '0');
      const timeStr = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
      a.download = `bookkeeping_${dateStr}_${timeStr}.${ext}`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setShowExport(false);
      Toast.show({ content: '已导出' });
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '导出失败' });
    }
  };

  return (
    <div className="page">
      <NavBar
        back={null}
        style={{ background: '#fff' }}
        right={
          <span
            style={{ fontSize: 14, color: '#1677ff', cursor: 'pointer' }}
            onClick={() => window.open('https://bookkeeping.zhangyuning.xyz/app-update/latest.apk', '_blank')}
          >
            下载 App
          </span>
        }
      >
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

        <div style={{ fontWeight: 600, marginBottom: 8 }}>通用</div>
        <List style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
          <List.Item
            onClick={() => navigate('/settings/ledgers')}
            extra={<span style={{ color: '#999', fontSize: 13 }}>›</span>}
          >
            账本管理
          </List.Item>
          <List.Item
            onClick={openExport}
            extra={<span style={{ color: '#999', fontSize: 13 }}>›</span>}
          >
            导出数据
          </List.Item>
        </List>

        <Button block color="danger" fill="outline" onClick={handleLogout}>
          退出登录
        </Button>
      </div>

      {/* 导出数据弹窗 */}
      <Popup
        visible={showExport}
        onMaskClick={() => setShowExport(false)}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 12 }}>导出数据</h3>

          <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>选择账本</div>
          <div style={{ maxHeight: '40vh', overflowY: 'auto', marginBottom: 12 }}>
            {ledgers.map((l) => (
              <div
                key={l.id}
                onClick={() => toggleExportLedger(l.id)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 4px',
                  borderBottom: '1px solid #f5f5f5',
                }}
              >
                <span style={{ fontSize: 14 }}>{l.name}</span>
                <Checkbox checked={exportLedgerIds.includes(l.id)} />
              </div>
            ))}
          </div>

          <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>格式</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[
              { key: 'excel', label: 'Excel' },
              { key: 'json', label: 'JSON（备份）' },
            ].map((f) => (
              <div
                key={f.key}
                onClick={() => setExportFormat(f.key as 'excel' | 'json')}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '8px 0',
                  borderRadius: 8,
                  background: exportFormat === f.key ? '#1677ff' : '#f5f5f5',
                  color: exportFormat === f.key ? '#fff' : '#666',
                  fontSize: 13,
                }}
              >
                {f.label}
              </div>
            ))}
          </div>

          <Button block color="primary" onClick={doExport}>
            导出
          </Button>
        </div>
      </Popup>
    </div>
  );
}
