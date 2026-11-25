import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const THEME_COLORS = [
  { key: 'blue', value: '#1677ff', label: '蓝色' },
  { key: 'green', value: '#00b578', label: '绿色' },
  { key: 'purple', value: '#722ed1', label: '紫色' },
  { key: 'orange', value: '#fa8c16', label: '橙色' },
  { key: 'pink', value: '#eb2f96', label: '粉色' },
  { key: 'gray', value: '#666666', label: '深灰' },
];

interface ThemeState {
  /** 主题主色（hex） */
  themeColor: string;
  /** 深色模式 */
  darkMode: boolean;
  setThemeColor: (c: string) => void;
  setDarkMode: (b: boolean) => void;
}

/**
 * 主题偏好（主题色 + 深色模式）。持久化到 localStorage，由 applyTheme 应用到 DOM。
 */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      themeColor: '#1677ff',
      darkMode: false,
      setThemeColor: (c) => set({ themeColor: c }),
      setDarkMode: (b) => set({ darkMode: b }),
    }),
    { name: 'bookkeeping-theme' },
  ),
);
