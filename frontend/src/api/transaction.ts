import api from './client';

export const transactionApi = {
  list: (ledgerId: string, params?: Record<string, string>) =>
    api.get(`/ledgers/${ledgerId}/transactions`, { params }),
  create: (data: {
    ledgerId: string;
    categoryId?: string;
    type: string;
    amount: number;
    note?: string;
    occurredAt: string;
  }) => api.post('/transactions', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/transactions/${id}`, data),
  remove: (id: string) => api.delete(`/transactions/${id}`),
};
