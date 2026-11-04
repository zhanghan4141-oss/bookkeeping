import api from './client';

export const categoryApi = {
  list: (ledgerId: string) => api.get(`/ledgers/${ledgerId}/categories`),
  create: (ledgerId: string, data: { name: string; type: string; icon?: string; color?: string; sortOrder?: number }) =>
    api.post(`/ledgers/${ledgerId}/categories`, data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/categories/${id}`, data),
  remove: (id: string) => api.delete(`/categories/${id}`),
};
