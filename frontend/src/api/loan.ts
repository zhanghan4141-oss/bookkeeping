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
  updateRepayments: (
    id: string,
    customPeriods: { kind?: 'period' | 'prepay'; dueDate: string; totalAmount: number }[],
  ) => api.patch(`/loans/${id}/repayments`, { customPeriods }),
  prepay: (
    id: string,
    data: { amount: number; prepayDate: string; mode?: 'reduce_payment' | 'reduce_term' },
  ) => api.post(`/loans/${id}/prepay`, data),
};
