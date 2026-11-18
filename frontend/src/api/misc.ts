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
  // excludeLedgerIds：账本页统计勾选（未勾选账本从统计排除；不传=全部）
  overview: (excludeIds?: string[]) =>
    api.get('/stats/overview', {
      params: { excludeLedgerIds: excludeIds?.length ? excludeIds.join(',') : undefined },
    }),
  categoryTransactions: (params: Record<string, string>) =>
    api.get('/stats/category-transactions', { params }),
};

export const auditLogApi = {
  list: (ledgerId: string, params?: Record<string, string>) =>
    api.get('/audit-logs', { params: { ledgerId, ...params } }),
};
