import { useContext, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, Input, List, NavBar, Picker, Popup, Stepper, Switch, Toast } from 'antd-mobile';
import { Capacitor } from '@capacitor/core';
import api from '../api/client';
import { ledgerApi } from '../api/ledger';
import { settingsApi } from '../api/misc';
import { checkAppUpdate } from '../lib/appUpdate';
import { downloadApk } from '../lib/downloadApk';
import { formatDate } from '../lib/format';
import { TabActiveContext } from '../components/KeepAlive';
import { useAuthStore } from '../stores/auth';
import { useThemeStore, THEME_COLORS } from '../stores/themeStore';
import { useBusy } from '../hooks/useBusy';
import { usePopupBack } from '../hooks/usePopupBack';
import type { Ledger, ReminderSetting } from '../types';

export default function Settings() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const pageRef = useRef<HTMLDivElement>(null);
  const isActive = useContext(TabActiveContext);
  const logout = useAuthStore((s) => s.logout);
  const themeColor = useThemeStore((s) => s.themeColor);
  const darkMode = useThemeStore((s) => s.darkMode);
  const setThemeColor = useThemeStore((s) => s.setThemeColor);
  const setDarkMode = useThemeStore((s) => s.setDarkMode);
  const [showExport, setShowExport] = useState(false);
  const [exportLedgerIds, setExportLedgerIds] = useState<string[]>([]);
  const [exportFormat, setExportFormat] = useState<'excel' | 'json'>('excel');
  // 全量导出耗时较长，按钮转圈防重复点击
  const { busy: exportBusy, run: runExport } = useBusy();

  usePopupBack(showExport, () => setShowExport(false));

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
      const dateStr = formatDate(now).replace(/-/g, '');
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
    <div className="page" ref={pageRef}>
      <NavBar
        back={null}
        style={{ background: 'var(--card)' }}
        right={
          <span
            style={{ fontSize: 14, color: 'var(--primary)', cursor: 'pointer' }}
            onClick={() => {
              // App 内：检测更新；Web/PWA：仍提供下载 App 入口
              if (Capacitor.isNativePlatform()) {
                checkAppUpdate({ notifyNoUpdate: true });
                return;
              }
              downloadApk();
            }}
          >
            {Capacitor.isNativePlatform() ? '检测更新' : '下载 App'}
          </span>
        }
      >
        我的
      </NavBar>

      <div style={{ padding: 16 }}>
        <div style={{ background: 'var(--card)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
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
                checked={setting?.pushEnabled ?? true}
                onChange={(v) => save({ pushEnabled: v })}
              />
            }
          >
            App 推送提醒
          </List.Item>
          {setting?.pushEnabled && (
            <List.Item
              extra={
                <Picker
                  columns={[
                    Array.from({ length: 24 }, (_, i) => ({
                      label: String(i).padStart(2, '0'),
                      value: String(i).padStart(2, '0'),
                    })),
                    Array.from({ length: 60 }, (_, i) => ({
                      label: String(i).padStart(2, '0'),
                      value: String(i).padStart(2, '0'),
                    })),
                  ]}
                  value={(setting?.remindTime ?? '08:00').split(':')}
                  onConfirm={(v) =>
                    save({ remindTime: `${String(v[0]).padStart(2, '0')}:${String(v[1]).padStart(2, '0')}` })
                  }
                >
                  {(items, actions) => (
                    <span
                      onClick={() => actions.open()}
                      style={{ color: 'var(--primary)', fontSize: 14 }}
                    >
                      {items.length >= 2
                        ? `${items[0]?.label}:${items[1]?.label}`
                        : (setting?.remindTime ?? '08:00')}{' '}
                      ▾
                    </span>
                  )}
                </Picker>
              }
            >
              提醒时间
            </List.Item>
          )}
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
            extra={
              <div style={{ display: 'flex', gap: 8 }}>
                {THEME_COLORS.map((c) => (
                  <div
                    key={c.key}
                    onClick={() => setThemeColor(c.value)}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: c.value,
                      cursor: 'pointer',
                      boxShadow:
                        themeColor === c.value
                          ? '0 0 0 2px var(--card), 0 0 0 4px ' + c.value
                          : undefined,
                    }}
                  />
                ))}
              </div>
            }
          >
            主题色
          </List.Item>
          <List.Item
            extra={<Switch checked={darkMode} onChange={setDarkMode} />}
          >
            深色模式
          </List.Item>
          <List.Item
            onClick={() => navigate('/settings/ledgers')}
            extra={<span style={{ color: 'var(--text-muted)', fontSize: 13 }}>›</span>}
          >
            账本管理
          </List.Item>
          <List.Item
            onClick={() => navigate('/settings/audit-logs')}
            extra={<span style={{ color: 'var(--text-muted)', fontSize: 13 }}>›</span>}
          >
            日志查询
          </List.Item>
          <List.Item
            onClick={openExport}
            extra={<span style={{ color: 'var(--text-muted)', fontSize: 13 }}>›</span>}
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
        getContainer={() => pageRef.current ?? document.body}
        disableBodyScroll={isActive}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 12 }}>导出数据</h3>

          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>选择账本</div>
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
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span style={{ fontSize: 14 }}>{l.name}</span>
                <Checkbox checked={exportLedgerIds.includes(l.id)} />
              </div>
            ))}
          </div>

          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>格式</div>
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
                  background: exportFormat === f.key ? 'var(--primary)' : 'var(--fill)',
                  color: exportFormat === f.key ? '#fff' : 'var(--text-secondary)',
                  fontSize: 13,
                }}
              >
                {f.label}
              </div>
            ))}
          </div>

          <Button block color="primary" loading={exportBusy} onClick={() => runExport(doExport)}>
            导出
          </Button>
        </div>
      </Popup>
    </div>
  );
}
