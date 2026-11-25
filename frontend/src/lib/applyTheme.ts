function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

/**
 * 应用主题：切换 data-theme + 写入主色及其浅底派生色。
 * 纯函数，可在 main.tsx 启动早期 / App 订阅 store 变化时调用。
 */
export function applyTheme({
  themeColor,
  darkMode,
}: {
  themeColor: string;
  darkMode: boolean;
}) {
  const root = document.documentElement;
  root.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  root.style.setProperty('--primary', themeColor);
  root.style.setProperty('--adm-color-primary', themeColor);

  const { r, g, b } = hexToRgb(themeColor);
  const alpha = darkMode ? 0.16 : 0.1;
  root.style.setProperty('--primary-weak', `rgba(${r}, ${g}, ${b}, ${alpha})`);

  // 更新浏览器/WebView 顶部主题色
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', darkMode ? '#1a1d23' : themeColor);
}
