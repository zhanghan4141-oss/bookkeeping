import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Input, NavBar, Picker, Toast } from 'antd-mobile';
import { loanApi } from '../api/loan';
import { invalidateFinancialData } from '../lib/invalidate';
import { formatMoney } from '../lib/format';
import type { Loan } from '../types';

const METHODS = [
  { label: '等额本息', value: 'equal_installment' },
  { label: '等额本金', value: 'equal_principal' },
  { label: '先息后本', value: 'interest_first' },
  { label: '自定义', value: 'custom' },
];

/** 前端预览计算（等额本息/本金/先息后本），与后端一致 */
function calcPlan(params: {
  principal: number;
  annualRate: number;
  termMonths: number;
  method: string;
}) {
  const { principal, annualRate, termMonths, method } = params;
  const r = annualRate / 100 / 12;
  const list: { principal: number; interest: number; total: number }[] = [];
  if (method === 'equal_principal') {
    const mp = principal / termMonths;
    let remain = principal;
    for (let i = 0; i < termMonths; i++) {
      const interest = remain * r;
      list.push({ principal: mp, interest, total: mp + interest });
      remain -= mp;
    }
  } else if (method === 'interest_first') {
    const mi = principal * r;
    for (let i = 0; i < termMonths; i++) {
      const principalPart = i === termMonths - 1 ? principal : 0;
      list.push({ principal: principalPart, interest: mi, total: mi + principalPart });
    }
  } else {
    if (r === 0) {
      const mp = principal / termMonths;
      for (let i = 0; i < termMonths; i++) list.push({ principal: mp, interest: 0, total: mp });
    } else {
      const f = Math.pow(1 + r, termMonths);
      const monthly = (principal * r * f) / (f - 1);
      let remain = principal;
      for (let i = 0; i < termMonths; i++) {
        const interest = remain * r;
        let p = monthly - interest;
        if (i === termMonths - 1) p = remain;
        list.push({ principal: p, interest, total: p + interest });
        remain -= p;
      }
    }
  }
  return list;
}

interface LoanFormState {
  name: string;
  principal: string;
  annualRate: string;
  termMonths: string;
  repaymentDay: string;
  method: string;
  startDate: string;
  note: string;
}

export default function LoanForm() {
  const { id, ledgerId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = !!id;

  const DRAFT_KEY = 'loanForm:draft';

  const defaultForm = (): LoanFormState => ({
    name: '',
    principal: '',
    annualRate: '',
    termMonths: '',
    repaymentDay: '1',
    method: 'equal_installment',
    startDate: new Date().toISOString().slice(0, 10),
    note: '',
  });

  // 新建模式：从草稿恢复上次填写的内容（刷新不丢失）；编辑模式：等 existingLoan 回填
  const [form, setForm] = useState<LoanFormState>(() => {
    if (isEdit) return defaultForm();
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        return { ...defaultForm(), ...(JSON.parse(raw) as Partial<LoanFormState>) };
      }
    } catch {
      // ignore
    }
    return defaultForm();
  });

  // 新建模式：实时保存草稿，刷新不丢失
  useEffect(() => {
    if (isEdit) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {
      // ignore
    }
  }, [form, isEdit]);

  // 编辑模式：加载贷款数据回填
  const { data: existingLoan } = useQuery({
    queryKey: ['loan', 'edit', id],
    queryFn: async () => (await loanApi.get(id!)).data as Loan,
    enabled: isEdit,
  });

  const [initializedId, setInitializedId] = useState<string | null>(null);
  useEffect(() => {
    if (existingLoan && initializedId !== existingLoan.id) {
      setForm({
        name: existingLoan.name,
        principal: existingLoan.principal,
        annualRate: existingLoan.annualRate,
        termMonths: String(existingLoan.termMonths),
        repaymentDay: String(existingLoan.repaymentDay),
        method: existingLoan.repaymentMethod,
        startDate: existingLoan.startDate.slice(0, 10),
        note: existingLoan.note ?? '',
      });
      setInitializedId(existingLoan.id);
    }
  }, [existingLoan, initializedId]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const isCustom = form.method === 'custom';
  // 编辑非自定义贷款：基础信息只读，还款方式只能保持当前或切到自定义
  const isEditNonCustom = isEdit && !isCustom;

  const methodOptions = useMemo(() => {
    if (isEdit && isCustom) return METHODS.filter((m) => m.value === 'custom');
    if (isEdit && !isCustom) {
      return METHODS.filter((m) => m.value === form.method || m.value === 'custom');
    }
    return METHODS;
  }, [isEdit, isCustom, form.method]);

  const plan = useMemo(() => {
    const principal = Number(form.principal);
    const annualRate = Number(form.annualRate);
    const termMonths = Number(form.termMonths);
    if (!principal || !termMonths) return null;
    // 自定义方式也显示预览：按等额本息生成默认计划（与后端一致）
    const method = form.method === 'custom' ? 'equal_installment' : form.method;
    return calcPlan({ principal, annualRate, termMonths, method });
  }, [form.principal, form.annualRate, form.termMonths, form.method]);

  const totalRepay = plan?.reduce((s, p) => s + p.total, 0) ?? 0;
  const totalInterest = plan?.reduce((s, p) => s + p.interest, 0) ?? 0;

  const onSubmit = async () => {
    // 手动必填校验
    if (!form.name.trim()) {
      Toast.show({ content: '请输入贷款名称' });
      return;
    }
    if (!form.principal || Number(form.principal) < 0) {
      Toast.show({ content: '请输入本金' });
      return;
    }
    if (!form.annualRate || Number(form.annualRate) < 0) {
      Toast.show({ content: '请输入年利率' });
      return;
    }
    if (!form.termMonths || Number(form.termMonths) <= 0) {
      Toast.show({ content: '请输入期数' });
      return;
    }
    if (!form.startDate) {
      Toast.show({ content: '请选择开始日期' });
      return;
    }

    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        repaymentMethod: form.method,
        note: form.note || undefined,
      };
      // 新建或编辑自定义贷款时带基础字段；编辑非自定义（未切到自定义）不带，
      // 否则后端会因「非自定义基础信息不可改」直接拒绝。
      if (!isEdit || isCustom) {
        payload.principal = Number(form.principal);
        payload.annualRate = Number(form.annualRate);
        payload.startDate = form.startDate;
        payload.termMonths = Number(form.termMonths);
        payload.repaymentDay = Number(form.repaymentDay);
      }
      // 自定义方式不传 customPeriods，后端会自动按等额本息生成默认计划
      if (isEdit) {
        await loanApi.update(id!, payload);
      } else {
        await loanApi.create({ ...payload, ledgerId });
        // 创建成功后清除草稿
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

  const labelStyle = { fontSize: 13, color: '#666', marginBottom: 4 } as const;
  const fieldWrap = { marginBottom: 14 } as const;

  return (
    <div className="page" style={{ background: '#fff' }}>
      <NavBar onBack={() => navigate(-1)}>{isEdit ? '编辑贷款' : '添加贷款'}</NavBar>

      <div style={{ padding: 16 }}>
        <div style={fieldWrap}>
          <div style={labelStyle}>贷款名称 <span style={{ color: '#ff4d4f' }}>*</span></div>
          <Input placeholder="如：房贷" value={form.name} onChange={(v) => set('name', v)} />
        </div>

        <div style={fieldWrap}>
          <div style={labelStyle}>本金（元）<span style={{ color: '#ff4d4f' }}>*</span></div>
          <Input type="number" placeholder="100000" value={form.principal} onChange={(v) => set('principal', v)} disabled={isEditNonCustom} />
        </div>

        <div style={fieldWrap}>
          <div style={labelStyle}>年利率（%）<span style={{ color: '#ff4d4f' }}>*</span></div>
          <Input type="number" placeholder="4.9" value={form.annualRate} onChange={(v) => set('annualRate', v)} disabled={isEditNonCustom} />
        </div>

        <div style={fieldWrap}>
          <div style={labelStyle}>期数（月）<span style={{ color: '#ff4d4f' }}>*</span></div>
          <Input type="number" placeholder="12" value={form.termMonths} onChange={(v) => set('termMonths', v)} disabled={isEditNonCustom} />
        </div>

        <div style={fieldWrap}>
          <div style={labelStyle}>每月还款日</div>
          <Picker
            columns={[Array.from({ length: 28 }, (_, i) => ({ label: `${i + 1} 号`, value: String(i + 1) }))]}
            value={[form.repaymentDay]}
            onConfirm={(v) => set('repaymentDay', String(v[0]))}
          >
            {(items, actions) => (
              <div onClick={() => !isEditNonCustom && actions.open()} style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px', opacity: isEditNonCustom ? 0.6 : 1 }}>
                {items[0]?.label ?? `${form.repaymentDay} 号`}
              </div>
            )}
          </Picker>
        </div>

        <div style={fieldWrap}>
          <div style={labelStyle}>开始日期<span style={{ color: '#ff4d4f' }}>*</span></div>
          <DatePicker
            value={new Date(form.startDate)}
            onConfirm={(v) => v && set('startDate', v.toISOString().slice(0, 10))}
          >
            {(value, actions) => (
              <div onClick={() => !isEditNonCustom && actions.open()} style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px', opacity: isEditNonCustom ? 0.6 : 1 }}>
                {value ? value.toISOString().slice(0, 10) : '选择日期'}
              </div>
            )}
          </DatePicker>
        </div>

        <div style={fieldWrap}>
          <div style={labelStyle}>还款方式</div>
          <Picker
            columns={[methodOptions]}
            value={[form.method]}
            onConfirm={(v) => set('method', String(v[0]))}
          >
            {(_items, actions) => {
              const currentLabel =
                METHODS.find((m) => m.value === form.method)?.label ?? '等额本息';
              return (
                <div onClick={() => actions.open()} style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px' }}>
                  {currentLabel}
                </div>
              );
            }}
          </Picker>
        </div>

        {isEdit && isCustom && (
          <div className="text-secondary" style={{ fontSize: 12, marginBottom: 8 }}>
            自定义贷款不支持改为其他还款方式
          </div>
        )}
        {isCustom && !isEdit && (
          <div className="text-secondary" style={{ fontSize: 12, marginBottom: 8 }}>
            将按等额本息自动生成默认还款计划，创建后可在贷款详情中编辑每期金额和日期
          </div>
        )}

        <div style={fieldWrap}>
          <div style={labelStyle}>备注</div>
          <Input placeholder="可选" value={form.note} onChange={(v) => set('note', v)} />
        </div>

        <Button block type="submit" color="primary" size="large" onClick={onSubmit} style={{ marginTop: 8 }}>
          {isEdit ? '保存' : '创建'}
        </Button>

        {plan && (
          <div style={{ background: '#f5f6f8', borderRadius: 12, padding: 16, marginTop: 16 }}>
            <div className="text-secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              {isCustom ? '默认还款计划预览（按等额本息生成，创建后可编辑）' : '还款计划预览'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div className="text-secondary" style={{ fontSize: 12 }}>还款总额</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>¥{formatMoney(totalRepay)}</div>
              </div>
              <div>
                <div className="text-secondary" style={{ fontSize: 12 }}>总利息</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#faad14' }}>¥{formatMoney(totalInterest)}</div>
              </div>
            </div>
            <div className="text-secondary" style={{ fontSize: 12, marginBottom: 4 }}>
              前 {Math.min(plan.length, 5)} 期预览
            </div>
            {plan.slice(0, 5).map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #eee' }}>
                <span>第{i + 1}期</span>
                <span>本金 ¥{formatMoney(p.principal)}</span>
                <span>利息 ¥{formatMoney(p.interest)}</span>
                <span style={{ fontWeight: 600 }}>¥{formatMoney(p.total)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
