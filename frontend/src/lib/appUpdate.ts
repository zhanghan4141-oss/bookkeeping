import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { FileOpener } from '@capacitor-community/file-opener';
import { Directory, Filesystem } from '@capacitor/filesystem';
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

/** 在 App 内下载 APK → 调系统安装器 → 安装后清理安装包（失败时回退浏览器打开） */
async function installUpdate(url: string, fileName: string) {
  try {
    Toast.show({ content: '正在下载更新包…' });
    // 1. 下载到应用缓存（FileProvider 已暴露 cache 目录，无需外部存储权限）
    await Filesystem.downloadFile({
      url,
      path: fileName,
      directory: Directory.Cache,
    });
    Toast.show({ content: '下载完成，正在打开安装器…' });

    // 2. 打开系统安装器（Android 首次会引导「允许安装未知应用」）
    try {
      const uri = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
      await FileOpener.open({
        filePath: uri.uri,
        contentType: 'application/vnd.android.package-archive',
      });
    } catch {
      // FileOpener 打开失败时回退浏览器
      await Browser.open({ url });
      return;
    }

    // 3. 安装器通常会短暂读取 APK，稍作延迟再清理缓存安装包；
    //    删除失败静默（缓存目录本身会被系统自动回收）
    setTimeout(async () => {
      try {
        await Filesystem.deleteFile({ path: fileName, directory: Directory.Cache });
        Toast.show({ content: '安装包已清理' });
      } catch {
        // 静默
      }
    }, 8000);
  } catch (e: any) {
    // 下载/打开失败：回退浏览器下载，保证功能可用
    await Browser.open({ url });
  }
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
    const fileName = `bookkeeping-${m.version}.apk`;
    Dialog.confirm({
      title: `发现新版本 v${m.version}`,
      content: m.note || '是否立即下载更新？',
      confirmText: '立即下载',
      cancelText: '稍后再说',
      onConfirm: async () => {
        await installUpdate(apkUrl, fileName);
      },
    });
  } catch {
    // 静默失败，不影响正常使用
  }
}
