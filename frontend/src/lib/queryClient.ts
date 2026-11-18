import { QueryClient } from '@tanstack/react-query';

/** 全局唯一的 QueryClient：供组件与跨模块工具（如登出清理）共用 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});