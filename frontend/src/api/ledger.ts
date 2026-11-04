import api from './client';

export const ledgerApi = {
  list: () => api.get('/ledgers'),
  get: (id: string) => api.get(`/ledgers/${id}`),
  create: (data: { name: string; type: string; icon?: string; color?: string; currency?: string }) =>
    api.post('/ledgers', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/ledgers/${id}`, data),
  remove: (id: string) => api.delete(`/ledgers/${id}`),
  members: (id: string) => api.get(`/ledgers/${id}/members`),
  addMember: (id: string, data: { email: string; role: string }) =>
    api.post(`/ledgers/${id}/members`, data),
  updateMember: (id: string, userId: string, role: string) =>
    api.patch(`/ledgers/${id}/members/${userId}`, { role }),
  removeMember: (id: string, userId: string) =>
    api.delete(`/ledgers/${id}/members/${userId}`),
};
