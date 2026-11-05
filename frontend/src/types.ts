export interface Ledger {
  id: string;
  name: string;
  type: 'daily' | 'loan' | 'custom';
  icon?: string | null;
  color?: string | null;
  currency: string;
  role?: 'owner' | 'editor' | 'viewer';
  updatedAt?: string;
  createdAt?: string;
}

export interface Category {
  id: string;
  ledgerId: string;
  name: string;
  type: 'expense' | 'income';
  icon?: string | null;
  color?: string | null;
  sortOrder: number;
  isBuiltin: boolean;
}

export interface Transaction {
  id: string;
  ledgerId: string;
  categoryId: string | null;
  userId: string;
  type: 'expense' | 'income' | 'transfer';
  amount: string;
  note: string | null;
  occurredAt: string;
  loanId?: string | null;
  category?: { id: string; name: string; icon: string | null; color: string | null; type: string } | null;
  user?: { id: string; nickname: string; avatarUrl: string | null };
  loan?: { id: string; name: string } | null;
}

export interface LoanRepayment {
  id: string;
  loanId: string;
  periodNo: number;
  kind: 'period' | 'prepay';
  dueDate: string;
  principalAmount: string;
  interestAmount: string;
  totalAmount: string;
  paidAmount: string;
  status: 'pending' | 'partial' | 'paid' | 'overdue';
  paidDate: string | null;
  note?: string | null;
}

export interface Loan {
  id: string;
  ledgerId: string;
  name: string;
  direction: 'borrow' | 'lend';
  principal: string;
  annualRate: string;
  startDate: string;
  termMonths: number;
  repaymentDay: number;
  repaymentMethod: 'equal_installment' | 'equal_principal' | 'interest_first' | 'custom';
  status: 'active' | 'paid_off' | 'closed';
  note: string | null;
  actualAnnualRate?: number | null;
  remainingPrincipal?: number;
  remainingInterest?: number;
  repayments: LoanRepayment[];
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  relatedLoanId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface ReminderSetting {
  id: string;
  userId: string;
  leadDays: number;
  emailEnabled: boolean;
  email: string | null;
  inappEnabled: boolean;
}

export interface StatSummary {
  period: 'month' | 'year';
  calendar: 'solar' | 'lunar';
  totalIncome: number;
  totalExpense: number;
  surplus: number;
  byCategory: { categoryId: string; name: string; type: string; color: string | null; icon: string | null; amount: number }[];
  trend: { key: string; income: number; expense: number }[];
}

export interface LedgerSummary {
  ledgerId: string;
  income: number;
  expense: number;
  surplus: number;
}
