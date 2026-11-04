import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, DatePicker, Form, Input, NavBar, Picker, Toast } from 'antd-mobile';
import { loanApi } from '../api/loan';
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

/** 前端 XIRR 计算 */
function calcXIRR(principal: number, startDate: string, periods: { dueDate: string; totalAmount: number }[]): number | null {
  if (principal <= 0 || periods.length === 0) return null;
  const t0 = new Date(startDate).getTime();
  const flows = [
    { t: 0, amount: -principal },
    ...periods.map((p) => ({ t: (new Date(p.dueDate).getTime() - t0) / (365.25 * 24 * 3600 * 1000), amount: p.totalAmount })),
  ].filter((f, i) => i === 0 || f.t > 0);
  if (flows.length < 2) return null;

  let rate = 0.1;
  for (let iter = 0; iter < 100; iter++) {
    let npv = 0;
    let dnpv = 0;
    for (const f of flows) {
      const df = Math.pow(1 + rate, f.t);
      npv += f.amount / df;
      dnpv += (-f.t * f.amount) / (df * (1 + rate));
    }
    if (dnpv === 0) break;
    const newRate = rate - npv / dnpv;
    if (Math.abs(newRate - rate) < 1e-10) { rate = newRate; break; }
    rate = newRate;
  }
  if (!isFinite(rate) || rate <= -0.99) return null;
  return rate;
}

function fmt(n: number) {
  return Math.round(n * 100) / 100;
}

export default function LoanForm() {
  const { id, ledgerId } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;
  const [form, setForm] = useState({
    name: '',
    principal: '',
    annualRate: '',
    termMonths: '',
    repaymentDay: '1',
    method: 'equal_installment',
    startDate: new Date().toISOString().slice(0, 10),
    note: '',
  });
  const [customPeriods, setCustomPeriods] = useState<{ dueDate: string; totalAmount: string }[]>([]);
  const [loaded, setLoaded] = useState(false);

  // 编辑模式：加载贷款数据回填
  const { data: existingLoan } = useQuery({
    queryKey: ['loan', id],
    queryFn: async () => (await loanApi.get(id!)).data as Loan,
    enabled: isEdit,
  });

  useEffect(() => {
    if (existingLoan && !loaded) {
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
      if (existingLoan.repaymentMethod === 'custom') {
        setCustomPeriods(
          existingLoan.repayments.map((r) => ({
            dueDate: r.dueDate.slice(0, 10),
            totalAmount: r.totalAmount,
          })),
        );
      }
      setLoaded(true);
    }
  }, [existingLoan, loaded]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // 编辑模式下，自定义贷款不能改成其他类型
  const isCustomLocked = isEdit && form.method === 'custom';
  const methodOptions = useMemo(
    () =>
      isCustomLocked
        ? METHODS.filter((m) => m.value === 'custom')
        : METHODS,
    [isCustomLocked],
  );

  const plan = useMemo(() => {
    const principal = Number(form.principal);
    const annualRate = Number(form.annualRate);
    const termMonths = Number(form.termMonths);
    if (!principal || !termMonths || form.method === 'custom') return null;
    return calcPlan({ principal, annualRate, termMonths, method: form.method });
  }, [form.principal, form.annualRate, form.termMonths, form.method]);

  const totalRepay = plan?.reduce((s, p) => s + p.total, 0) ?? 0;
  const totalInterest = plan?.reduce((s, p) => s + p.interest, 0) ?? 0;

  const onTermMonthsChange = (v: string) => {
    set('termMonths', v);
    const n = Math.max(0, parseInt(v, 10) || 0);
    setCustomPeriods((prev) => {
      const arr = [...prev];
      while (arr.length < n) arr.push({ dueDate: '', totalAmount: '' });
      while (arr.length > n) arr.pop();
      return arr;
    });
  };

  const customXirr = useMemo(() => {
    if (form.method !== 'custom') return null;
    const principal = Number(form.principal);
    const valid = customPeriods
      .filter((p) => p.dueDate && p.totalAmount)
      .map((p) => ({ dueDate: p.dueDate, totalAmount: Number(p.totalAmount) }));
    if (valid.length === 0) return null;
    return calcXIRR(principal, form.startDate, valid);
  }, [form.method, form.principal, form.startDate, customPeriods]);

  const onSubmit = async () => {
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        principal: Number(form.principal),
        annualRate: Number(form.annualRate),
        startDate: form.startDate,
        termMonths: Number(form.termMonths),
        repaymentDay: Number(form.repaymentDay),
        repaymentMethod: form.method,
        note: form.note || undefined,
      };
      if (form.method === 'custom') {
        if (customPeriods.length !== Number(form.termMonths)) {
          Toast.show({ content: `请填写 ${form.termMonths} 期的还款金额和日期` });
          return;
        }
        if (customPeriods.some((p) => !p.dueDate || !p.totalAmount)) {
          Toast.show({ content: '请完整填写每一期的日期和金额' });
          return;
        }
        payload.customPeriods = customPeriods.map((p) => ({
          dueDate: p.dueDate,
          totalAmount: Number(p.totalAmount),
        }));
      }
      if (isEdit) {
        await loanApi.update(id!, payload);
      } else {
        await loanApi.create({ ...payload, ledgerId });
      }
      Toast.show({ content: isEdit ? '已保存' : '已创建' });
      navigate(-1);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '保存失败' });
    }
  };

  return (
    <div className="page" style={{ background: '#fff' }}>
      <NavBar onBack={() => navigate(-1)}>{isEdit ? '编辑贷款' : '添加贷款'}</NavBar>

      <div style={{ padding: 16 }}>
        <Form layout="vertical" footer={
          <Button block type="submit" color="primary" size="large" onClick={onSubmit}>
            {isEdit ? '保存' : '创建'}
          </Button>
        }>
          <Form.Item name="name" label="贷款名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：房贷" value={form.name} onChange={(v) => set('name', v)} />
          </Form.Item>
          <Form.Item name="principal" label="本金（元）" rules={[{ required: true, message: '请输入本金' }]}>
            <Input type="number" placeholder="100000" value={form.principal} onChange={(v) => set('principal', v)} />
          </Form.Item>
          {form.method !== 'custom' && (
            <Form.Item name="annualRate" label="年利率（%）" rules={[{ required: true, message: '请输入年利率' }]}>
              <Input type="number" placeholder="4.9" value={form.annualRate} onChange={(v) => set('annualRate', v)} />
            </Form.Item>
          )}
          <Form.Item name="termMonths" label="期数（月）" rules={[{ required: true, message: '请输入期数' }]}>
            <Input type="number" placeholder="12" value={form.termMonths} onChange={onTermMonthsChange} />
          </Form.Item>
          {form.method !== 'custom' && (
            <Form.Item name="repaymentDay" label="每月还款日" trigger="onConfirm">
              <Picker
                columns={[Array.from({ length: 28 }, (_, i) => ({ label: `${i + 1} 号`, value: String(i + 1) }))]}
                value={[form.repaymentDay]}
                onConfirm={(v) => set('repaymentDay', String(v[0]))}
              >
                {(items, actions) => (
                  <div onClick={() => actions.open()}>
                    <Input value={String(items[0]?.label ?? '1 号')} readOnly />
                  </div>
                )}
              </Picker>
            </Form.Item>
          )}
          <Form.Item name="startDate" label="开始日期">
            <DatePicker
              value={new Date(form.startDate)}
              onConfirm={(v) => v && set('startDate', v.toISOString().slice(0, 10))}
            >
              {(value, actions) => (
                <div onClick={() => actions.open()}>
                  <Input value={value ? value.toISOString().slice(0, 10) : ''} readOnly />
                </div>
              )}
            </DatePicker>
          </Form.Item>
          <Form.Item name="method" label="还款方式" trigger="onConfirm">
            <Picker
              columns={[methodOptions]}
              value={[form.method]}
              onConfirm={(v) => {
                const newMethod = String(v[0]);
                set('method', newMethod);
                // 切换到自定义时，若还没期数则初始化
                if (newMethod === 'custom' && customPeriods.length === 0) {
                  const n = Number(form.termMonths) || 0;
                  setCustomPeriods(Array.from({ length: n }, () => ({ dueDate: '', totalAmount: '' })));
                }
              }}
            >
              {(items, actions) => (
                <div onClick={() => actions.open()}>
                  <Input value={String(items[0]?.label ?? '等额本息')} readOnly />
                </div>
              )}
            </Picker>
          </Form.Item>
          {isCustomLocked && (
            <div className="text-secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              自定义贷款不支持改为其他还款方式
            </div>
          )}
          <Form.Item name="note" label="备注">
            <Input placeholder="可选" value={form.note} onChange={(v) => set('note', v)} />
          </Form.Item>
        </Form>

        {/* 自定义还款方式：每期填写日期+金额 */}
        {form.method === 'custom' && Number(form.termMonths) > 0 && (
          <div style={{ background: '#f5f6f8', borderRadius: 12, padding: 16, marginTop: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>每期还款（日期 + 金额）</div>
            {customPeriods.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <span style={{ width: 50, fontSize: 13, color: '#666' }}>第{i + 1}期</span>
                <div style={{ flex: 1 }}>
                  <DatePicker
                    value={p.dueDate ? new Date(p.dueDate) : new Date()}
                    onConfirm={(v) => {
                      const date = v.toISOString().slice(0, 10);
                      setCustomPeriods((prev) => prev.map((x, j) => (j === i ? { ...x, dueDate: date } : x)));
                    }}
                  >
                    {(_value, actions) => (
                      <div onClick={() => actions.open()} style={{ background: '#fff', borderRadius: 6, padding: '6px 10px' }}>
                        {p.dueDate || '选择日期'}
                      </div>
                    )}
                  </DatePicker>
                </div>
                <div style={{ flex: 1 }}>
                  <Input
                    type="number"
                    placeholder="金额"
                    value={p.totalAmount}
                    onChange={(v) => setCustomPeriods((prev) => prev.map((x, j) => (j === i ? { ...x, totalAmount: v } : x)))}
                    style={{ background: '#fff', borderRadius: 6, padding: '6px 10px' }}
                  />
                </div>
              </div>
            ))}
            {customXirr !== null && (
              <div style={{ marginTop: 12, padding: 10, background: '#fff', borderRadius: 8, fontSize: 13 }}>
                实际年利率（XIRR）：<span style={{ fontWeight: 700, color: '#1677ff' }}>{(customXirr * 100).toFixed(2)}%</span>
              </div>
            )}
          </div>
        )}

        {plan && (
          <div style={{ background: '#f5f6f8', borderRadius: 12, padding: 16, marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div className="text-secondary" style={{ fontSize: 12 }}>还款总额</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>¥{fmt(totalRepay).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-secondary" style={{ fontSize: 12 }}>总利息</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#faad14' }}>¥{fmt(totalInterest).toFixed(2)}</div>
              </div>
            </div>
            <div className="text-secondary" style={{ fontSize: 12, marginBottom: 4 }}>
              前 {Math.min(plan.length, 5)} 期预览
            </div>
            {plan.slice(0, 5).map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #eee' }}>
                <span>第{i + 1}期</span>
                <span>本金 ¥{fmt(p.principal).toFixed(2)}</span>
                <span>利息 ¥{fmt(p.interest).toFixed(2)}</span>
                <span style={{ fontWeight: 600 }}>¥{fmt(p.total).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
