import axios from 'axios';
import { useAuthStore } from '../stores/auth';

// Capacitor App 内 origin 是 https://localhost，API 必须走绝对地址；
// 网页端走相对路径 /api（Vite 代理 / nginx 反代）。
declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean };
    APP_SERVER_ORIGIN?: string;
  }
}

const IS_APP = !!(
  window.Capacitor &&
  window.Capacitor.isNativePlatform &&
  window.Capacitor.isNativePlatform()
);
const SERVER_ORIGIN = IS_APP
  ? window.APP_SERVER_ORIGIN || 'https://bookkeeping.zhangyuning.xyz'
  : '';
const BASE_URL = `${SERVER_ORIGIN}/api`;

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const store = useAuthStore.getState();

    // 401 且未重试过，尝试 refresh
    if (status === 401 && !original?._retry && store.refreshToken) {
      original._retry = true;
      try {
        const res = await axios.post(`${BASE_URL}/auth/refresh`, {
          refreshToken: store.refreshToken,
        });
        const { accessToken, refreshToken, user } = res.data;
        useAuthStore.getState().setAuth({ accessToken, refreshToken, user });
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch {
        useAuthStore.getState().logout();
      }
    }
    return Promise.reject(error);
  },
);

export default api;
