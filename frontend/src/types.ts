export interface Ledger {
  id: string;
  name: string;
  type: 'daily' | 'loan' | 'custom';
  icon?: string | null;
  color?: string | null;
  currency: string;
  role?: 'owner' | 'editor' | 'viewer';
  memberCount?: number;
  updatedAt?: string;
  createdAt?: string;
  /** 所属空间（仅我拥有的账本有值；共享账本恒 null = 默认分组） */
  spaceId?: string | null;
}

export interface UserSpace {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  createdAt?: string;
  ledgerCount?: number;
}

export interface LedgerMember {
  id: string;
  ledgerId: string;
  userId: string;
  role: 'owner' | 'editor' | 'viewer';
  createdAt: string;
  user: { id: string; email: string; nickname: string; avatarUrl: string | null };
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
  _count?: { transactions: number };
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
  expensePlanId?: string | null;
  expensePlanPeriodId?: string | null;
  category?: { id: string; name: string; icon: string | null; color: string | null; type: string } | null;
  user?: { id: string; nickname: string; avatarUrl: string | null };
  loan?: { id: string; name: string } | null;
  expensePlan?: { id: string; name: string } | null;
  ledger?: { id: string; name: string } | null;
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
  /** 是否「操作过」（提前还/提前标记）：编辑计划时该期只改计划、流水冻结 */
  diverged?: boolean;
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

export interface ExpensePlanPeriod {
  id: string;
  planId: string;
  periodNo: number;
  dueDate: string;
  amount: string;
  status: 'pending' | 'paid';
  paidDate: string | null;
  note?: string | null;
  /** 是否「操作过」（实际金额/日期偏离计划）：编辑计划时该期只改计划、流水冻结 */
  diverged?: boolean;
  /** 实际支出金额（来自流水；已支出期有值） */
  paidAmount?: number;
}

export interface ExpensePlan {
  id: string;
  ledgerId: string;
  categoryId: string;
  name: string;
  periodAmount: string;
  termCount: number; // 0 = 不限
  frequency: 'month' | 'quarter' | 'year';
  startDate: string;
  day: number;
  status: 'active' | 'completed' | 'closed';
  note: string | null;
  createdAt?: string;
  totalCount: number;
  paidCount: number;
  pendingCount: number;
  totalPaid: number;
  totalRemaining: number;
  category?: { id: string; name: string } | null;
  periods: ExpensePlanPeriod[];
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
  pushEnabled: boolean;
  remindTime: string;
}

export interface StatSummary {
  period: 'day' | 'month' | 'year';
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

export interface StatBucket {
  income: number;
  expense: number;
  surplus: number;
}

export interface StatOverview {
  day: StatBucket;
  month: StatBucket;
  year: StatBucket;
  all: StatBucket;
}

export interface AuditLogItem {
  id: string;
  userId: string;
  nickname: string;
  action: 'update' | 'delete';
  entity: string;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}
