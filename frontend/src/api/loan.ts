import api from './client';

export const loanApi = {
  list: (ledgerId: string) => api.get(`/ledgers/${ledgerId}/loans`),
  get: (id: string) => api.get(`/loans/${id}`),
  create: (data: Record<string, unknown>) => api.post('/loans', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/loans/${id}`, data),
  remove: (id: string) => api.delete(`/loans/${id}`),
  pay: (id: string, periodNo: number, data: { amount: number; paidDate?: string }) =>
    api.post(`/loans/${id}/repayments/${periodNo}/pay`, data),
  undo: (id: string, periodNo: number) =>
    api.post(`/loans/${id}/repayments/${periodNo}/undo`),
};
