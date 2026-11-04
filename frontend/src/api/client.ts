import axios from 'axios';
import { useAuthStore } from '../stores/auth';

const api = axios.create({
  baseURL: '/api',
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
        const res = await axios.post('/api/auth/refresh', {
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
