import api from './client';

export const expensePlanApi = {
  list: (ledgerId: string) => api.get(`/ledgers/${ledgerId}/expense-plans`),
  get: (id: string) => api.get(`/expense-plans/${id}`),
  create: (data: Record<string, unknown>) => api.post('/expense-plans', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/expense-plans/${id}`, data),
  remove: (id: string) => api.delete(`/expense-plans/${id}`),
  mark: (
    id: string,
    periodNo: number,
    data: { amount?: number; paidDate?: string; applyToFuture?: boolean },
  ) => api.post(`/expense-plans/${id}/periods/${periodNo}/mark`, data),
  undo: (id: string, periodNo: number) =>
    api.post(`/expense-plans/${id}/periods/${periodNo}/undo`),
  exportPlan: (id: string) => api.get(`/expense-plans/${id}/export`, { responseType: 'blob' }),
};