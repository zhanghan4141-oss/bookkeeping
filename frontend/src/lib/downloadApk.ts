/**
 * App 下载：从 /app-update/manifest.json 取最新版本号，
 * 让下载文件名带上版本号（如 bookkeeping-1.2.1.apk），读取失败时回退 latest。
 * manifest.json 由 release-apk.yml 每次发版写入真实版本号。
 */

const DEFAULT_ORIGIN = 'https://bookkeeping.zhangyuning.xyz';

/** 读 manifest 拿最新版本号，失败返回 null */
async function fetchApkVersion(): Promise<string | null> {
  try {
    const origin = window.APP_SERVER_ORIGIN || DEFAULT_ORIGIN;
    const res = await fetch(`${origin}/app-update/manifest.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const m = await res.json();
    return m && m.version ? String(m.version) : null;
  } catch {
    return null;
  }
}

/** 触发浏览器下载 App（download 属性强制下载，移动端不会导航跳转） */
export async function downloadApk() {
  const version = await fetchApkVersion();
  const name = version ? `bookkeeping-${version}.apk` : 'bookkeeping-latest.apk';
  const a = document.createElement('a');
  a.href = `${DEFAULT_ORIGIN}/app-update/bookkeeping-latest.apk`;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}