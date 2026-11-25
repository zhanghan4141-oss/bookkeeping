import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, DatePicker, Input, NavBar, Picker, Toast } from 'antd-mobile';
import { expensePlanApi } from '../api/expense';
import { categoryApi } from '../api/category';
import { invalidateFinancialData } from '../lib/invalidate';
import { formatDate, formatMoney } from '../lib/format';
import type { Category, ExpensePlan } from '../types';

const FREQUENCIES = [
  { label: '月付', value: 'month' },
  { label: '季付', value: 'quarter' },
  { label: '年付', value: 'year' },
];
const UNIT_MONTHS: Record<string, number> = { month: 1, quarter: 3, year: 12 };

/** 与后端 periodDueDate 一致的到期日（首期 = 开始日；UTC 推进） */
function dueDateOfUnit(startDate: string, monthOffset: number, day: number): string {
  const [y, m] = startDate.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + monthOffset, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const actualDay = Math.min(day, lastDay);
  const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), actualDay));
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

function periodDueDateOf(startDate: string, frequency: string, day: number, periodNo: number): string {
  if (periodNo <= 1) return startDate.slice(0, 10);
  return dueDateOfUnit(startDate, (periodNo - 1) * (UNIT_MONTHS[frequency] ?? 1), day);
}

interface ExpenseFormState {
  name: string;
  categoryId: string;
  periodAmount: string;
  termCount: string;
  unlimited: boolean;
  frequency: string;
  day: string;
  startDate: string;
  note: string;
}

export default function ExpensePlanForm() {
  const { id, ledgerId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = !!id;
  const ledgerIdFinal = ledgerId ?? '';

  const DRAFT_KEY = 'expenseForm:draft';
  const todayNum = String(new Date().getDate());

  const defaultForm = (): ExpenseFormState => ({
    name: '',
    categoryId: '',
    periodAmount: '',
    termCount: '',
    unlimited: false,
    frequency: 'month',
    day: todayNum,
    startDate: formatDate(new Date()),
    note: '',
  });

  const [form, setForm] = useState<ExpenseFormState>(() => {
    if (isEdit) return defaultForm();
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        return { ...defaultForm(), ...(JSON.parse(raw) as Partial<ExpenseFormState>) };
      }
    } catch {
      // ignore
    }
    return defaultForm();
  });

  // 新建模式：实时保存草稿
  useEffect(() => {
    if (isEdit) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {
      // ignore
    }
  }, [form, isEdit]);

  // 编辑模式：回填时记录计划所属账本（先声明，供下方取类别使用）
  const [editLedgerId, setEditLedgerId] = useState<string | null>(null);

  // 账本支出类别（必选；编辑模式先拿到计划的 ledgerId 再取类别）
  const categoriesLedgerId =
    (isEdit ? editLedgerId : ledgerIdFinal) ?? ledgerIdFinal;
  const { data: categories = [] } = useQuery({
    queryKey: ['categories', categoriesLedgerId],
    queryFn: async () => (await categoryApi.list(categoriesLedgerId)).data as Category[],
    enabled: !!categoriesLedgerId,
  });
  const expenseCategories = categories.filter((c) => c.type === 'expense');

  // 编辑模式：回填
  const planIdForQuery = id ?? '';
  const { data: existingPlan } = useQuery({
    queryKey: ['expense-plan', 'edit', id],
    queryFn: async () => (await expensePlanApi.get(planIdForQuery)).data as ExpensePlan,
    enabled: isEdit,
  });
  useEffect(() => {
    if (existingPlan && editLedgerId !== existingPlan.ledgerId) {
      setForm({
        name: existingPlan.name,
        categoryId: existingPlan.categoryId,
        periodAmount: String(existingPlan.periodAmount),
        termCount: String(existingPlan.termCount),
        unlimited: existingPlan.termCount === 0,
        frequency: existingPlan.frequency,
        day: String(existingPlan.day),
        startDate: existingPlan.startDate.slice(0, 10),
        note: existingPlan.note ?? '',
      });
      setEditLedgerId(existingPlan.ledgerId);
    }
  }, [existingPlan, editLedgerId]);

  const set = (k: keyof ExpenseFormState, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  // 预览计划（首期 = 开始日；不限 = 展示前 24 期）
  const preview = useMemo(() => {
    const amount = Number(form.periodAmount);
    const total = form.unlimited ? 120 : Number(form.termCount);
    if (!form.startDate || !amount || (form.unlimited ? false : !total)) return null;
    const show = Math.min(total || 24, 24);
    return {
      total: form.unlimited ? '不限' : `${total} 期`,
      rows: Array.from({ length: show }, (_, i) => ({
        periodNo: i + 1,
        dueDate: periodDueDateOf(form.startDate, form.frequency, Number(form.day) || 1, i + 1),
      })),
    };
  }, [form.startDate, form.periodAmount, form.termCount, form.unlimited, form.frequency, form.day]);

  const onSubmit = async () => {
    if (!form.name.trim()) {
      Toast.show({ content: '请输入计划名称' });
      return;
    }
    if (!form.categoryId) {
      Toast.show({ content: '请选择支出类别' });
      return;
    }
    const amount = Number(form.periodAmount);
    if (!form.periodAmount || amount <= 0) {
      Toast.show({ content: '请输入每期金额' });
      return;
    }
    if (!form.unlimited && (!form.termCount || Number(form.termCount) <= 0)) {
      Toast.show({ content: '请输入期数或勾选不限' });
      return;
    }
    if (!form.startDate) {
      Toast.show({ content: '请选择开始日期' });
      return;
    }
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        categoryId: form.categoryId,
        periodAmount: Number(form.periodAmount),
        termCount: form.unlimited ? 0 : Number(form.termCount),
        frequency: form.frequency,
        day: Number(form.day),
        startDate: form.startDate,
        note: form.note || undefined,
      };
      if (isEdit) {
        await expensePlanApi.update(id!, payload);
      } else {
        await expensePlanApi.create({ ...payload, ledgerId: ledgerIdFinal });
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          // ignore
        }
      }
      Toast.show({ content: isEdit ? '已保存' : '已创建' });
      invalidateFinancialData(queryClient);
      navigate(-1);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '保存失败' });
    }
  };

  const labelStyle = { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 } as const;
  const fieldWrap = { marginBottom: 14 } as const;

  return (
    <div className="page" style={{ background: 'var(--card)' }}>
      <NavBar onBack={() => navigate(-1)}>{isEdit ? '编辑支出计划' : '添加支出计划'}</NavBar>

      <div style={{ padding: 16 }}>
        <div style={fieldWrap}>
          <div style={labelStyle}>计划名称 <span style={{ color: 'var(--expense)' }}>*</span></div>
          <Input placeholder="如：女儿生活费" value={form.name} onChange={(v) => set('name', v)} />
        </div>

        <div style={fieldWrap}>
          <div style={labelStyle}>支出类别 <span style={{ color: 'var(--expense)' }}>*</span></div>
          <Picker
            columns={[
              expenseCategories.map((c) => ({
                label: c.icon ? `${c.icon} ${c.name}` : c.name,
                value: c.id,
              })),
            ]}
            value={form.categoryId ? [form.categoryId] : []}
            onConfirm={(v) => set('categoryId', String(v[0]))}
          >
            {(_items, actions) => {
              const current = expenseCategories.find((c) => c.id === form.categoryId);
              return (
                <div onClick={() => actions.open()} style={{ background: 'var(--fill)', borderRadius: 8, padding: '10px 12px' }}>
                  {current ? (current.icon ? `${current.icon} ${current.name}` : current.name) : '选择支出类别'}
                </div>
              );
            }}
          </Picker>
        </div>

        <div style={fieldWrap}>
          <div style={labelStyle}>每期金额（元）<span style={{ color: 'var(--expense)' }}>*</span></div>
          <Input type="number" placeholder="1200" value={form.periodAmount} onChange={(v) => set('periodAmount', v)} />
        </div>

        <div style={fieldWrap}>
          <div style={labelStyle}>期数 <span style={{ color: 'var(--expense)' }}>*</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Input
              type="number"
              placeholder="如：12"
              value={form.unlimited ? '' : form.termCount}
              onChange={(v) => set('termCount', v)}
              disabled={form.unlimited}
              style={{ flex: 1 }}
            />
            <Checkbox checked={form.unlimited} onChange={(v) => set('unlimited', v)}>
              不限
            </Checkbox>
          </div>
          <div className="text-secondary" style={{ fontSize: 12, marginTop: 4 }}>
            勾选不限后按长期计划生成（120 期），后续可编辑期数
          </div>
        </div>

        <div style={fieldWrap}>
          <div style={labelStyle}>周期</div>
          <Picker
            columns={[FREQUENCIES]}
            value={[form.frequency]}
            onConfirm={(v) => set('frequency', String(v[0]))}
          >
            {(_items, actions) => (
              <div onClick={() => actions.open()} style={{ background: 'var(--fill)', borderRadius: 8, padding: '10px 12px' }}>
                {FREQUENCIES.find((f) => f.value === form.frequency)?.label ?? '月付'}
              </div>
            )}
          </Picker>
          {form.frequency !== 'month' && (
            <div className="text-secondary" style={{ fontSize: 12, marginTop: 4 }}>
              季/年付扣款日默认与开始日同日，可调整
            </div>
          )}
        </div>

        <div style={fieldWrap}>
          <div style={labelStyle}>每期扣款日</div>
          <Picker
            columns={[Array.from({ length: 31 }, (_, i) => ({ label: `${i + 1} 号`, value: String(i + 1) }))]}
            value={[form.day]}
            onConfirm={(v) => set('day', String(v[0]))}
          >
            {(items, actions) => (
              <div onClick={() => actions.open()} style={{ background: 'var(--fill)', borderRadius: 8, padding: '10px 12px' }}>
                {items[0]?.label ?? `${form.day} 号`}
              </div>
            )}
          </Picker>
        </div>

        <div style={fieldWrap}>
          <div style={labelStyle}>开始日期<span style={{ color: 'var(--expense)' }}>*</span></div>
          <DatePicker
            value={new Date(form.startDate)}
            onConfirm={(v) => v && set('startDate', formatDate(v))}
          >
            {(value, actions) => (
              <div onClick={() => actions.open()} style={{ background: 'var(--fill)', borderRadius: 8, padding: '10px 12px' }}>
                {value ? formatDate(value) : '选择日期'}
              </div>
            )}
          </DatePicker>
        </div>

        <div style={fieldWrap}>
          <div style={labelStyle}>备注</div>
          <Input placeholder="可选" maxLength={191} value={form.note} onChange={(v) => set('note', v)} />
        </div>

        <Button block type="submit" color="success" size="large" onClick={onSubmit} style={{ marginTop: 8 }}>
          {isEdit ? '保存' : '创建'}
        </Button>

        {preview && (
          <div style={{ background: '#f5f6f8', borderRadius: 12, padding: 16, marginTop: 16 }}>
            <div className="text-secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              计划预览（共 {preview.total}，每期 ¥{formatMoney(Number(form.periodAmount))}）
            </div>
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {preview.rows.map((p) => (
                <div key={p.periodNo} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span>第{p.periodNo}期</span>
                    <span className="text-secondary">{p.dueDate}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}