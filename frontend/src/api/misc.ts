import api from './client';

export const repaymentApi = {
  upcoming: (days: number, ledgerIds?: string[]) =>
    api.get('/repayments/upcoming', {
      params: { days, ledgerIds: ledgerIds?.join(',') },
    }),
};

export const notificationApi = {
  list: () => api.get('/notifications'),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch('/notifications/read-all'),
};

export const settingsApi = {
  getReminder: () => api.get('/settings/reminder'),
  updateReminder: (data: Record<string, unknown>) =>
    api.patch('/settings/reminder', data),
};

export const statApi = {
  ledgerSummary: (ledgerId: string, params?: Record<string, string>) =>
    api.get(`/ledgers/${ledgerId}/stats/summary`, { params }),
  summary: (params?: Record<string, string>) =>
    api.get('/stats/summary', { params }),
  ledgerSummaries: (period: string) =>
    api.get('/stats/ledgers', { params: { period } }),
  overview: () => api.get('/stats/overview'),
  categoryTransactions: (params: Record<string, string>) =>
    api.get('/stats/category-transactions', { params }),
};
