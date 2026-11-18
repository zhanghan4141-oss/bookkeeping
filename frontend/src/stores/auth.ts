import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { resetUserSession } from '../lib/resetSession';

export interface User {
  id: string;
  email: string;
  nickname: string;
  avatarUrl: string | null;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  setAuth: (data: { accessToken: string; refreshToken: string; user: User }) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setAuth: ({ accessToken, refreshToken, user }) =>
        set({ accessToken, refreshToken, user }),
      setUser: (user) => set({ user }),
      logout: () => {
        set({ accessToken: null, refreshToken: null, user: null });
        // 清除 query 缓存与选择类持久化，避免切换账号后短暂显示上一个账号的数据
        resetUserSession();
      },
    }),
    {
      name: 'bookkeeping-auth',
    },
  ),
);
