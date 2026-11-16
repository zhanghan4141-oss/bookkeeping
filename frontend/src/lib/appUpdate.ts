import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Dialog, Toast } from 'antd-mobile';

const DEFAULT_ORIGIN = 'https://bookkeeping.zhangyuning.xyz';

function cmpVersion(a: string, b: string) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/** 更新检查选项 */
export interface CheckAppUpdateOptions {
  /** 无新版本时提示「已是最新版本」（手动「检测更新」用）；启动自动检测保持静默 */
  notifyNoUpdate?: boolean;
}

/** App 内检查更新：读 /app-update/manifest.json，版本更高则弹窗提示下载 */
export async function checkAppUpdate(options: CheckAppUpdateOptions = {}) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const origin = window.APP_SERVER_ORIGIN || DEFAULT_ORIGIN;
    const res = await fetch(`${origin}/app-update/manifest.json`, { cache: 'no-store' });
    if (!res.ok) return;
    const m = await res.json();
    if (!m || !m.version || !m.apkUrl) return;

    const info = await CapacitorApp.getInfo();
    const installed = info?.version;
    if (!installed || cmpVersion(m.version, installed) <= 0) {
      if (options.notifyNoUpdate) Toast.show({ content: '已是最新版本' });
      return;
    }

    const apkUrl = m.apkUrl.startsWith('http') ? m.apkUrl : origin + m.apkUrl;
    Dialog.confirm({
      title: `发现新版本 v${m.version}`,
      content: m.note || '是否立即下载更新？',
      confirmText: '立即下载',
      cancelText: '稍后再说',
      onConfirm: async () => {
        try {
          await Browser.open({ url: apkUrl });
        } catch {
          // 浏览器打开失败时静默
        }
      },
    });
  } catch {
    // 静默失败，不影响正常使用
  }
}
