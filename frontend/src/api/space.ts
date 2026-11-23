import api from './client';

export const spaceApi = {
  list: () => api.get('/spaces'),
  create: (data: { name: string; icon?: string; color?: string }) => api.post('/spaces', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/spaces/${id}`, data),
  remove: (id: string) => api.delete(`/spaces/${id}`),
};