import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, DatePicker, Form, Input, NavBar, Picker, Toast } from 'antd-mobile';
import { loanApi } from '../api/loan';

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
    // equal_installment
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

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const plan = useMemo(() => {
    const principal = Number(form.principal);
    const annualRate = Number(form.annualRate);
    const termMonths = Number(form.termMonths);
    if (!principal || !termMonths || form.method === 'custom') return null;
    return calcPlan({ principal, annualRate, termMonths, method: form.method });
  }, [form.principal, form.annualRate, form.termMonths, form.method]);

  const totalRepay = plan?.reduce((s, p) => s + p.total, 0) ?? 0;
  const totalInterest = plan?.reduce((s, p) => s + p.interest, 0) ?? 0;

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
        <Form layout="vertical" onFinish={onSubmit} footer={
          <Button block type="submit" color="primary" size="large">
            {isEdit ? '保存' : '创建'}
          </Button>
        }>
          <Form.Item name="name" label="贷款名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：房贷" value={form.name} onChange={(v) => set('name', v)} />
          </Form.Item>
          <Form.Item name="principal" label="本金（元）" rules={[{ required: true, message: '请输入本金' }]}>
            <Input type="number" placeholder="100000" value={form.principal} onChange={(v) => set('principal', v)} />
          </Form.Item>
          <Form.Item name="annualRate" label="年利率（%）" rules={[{ required: true, message: '请输入年利率' }]}>
            <Input type="number" placeholder="4.9" value={form.annualRate} onChange={(v) => set('annualRate', v)} />
          </Form.Item>
          <Form.Item name="termMonths" label="期数（月）" rules={[{ required: true, message: '请输入期数' }]}>
            <Input type="number" placeholder="360" value={form.termMonths} onChange={(v) => set('termMonths', v)} />
          </Form.Item>
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
              columns={[METHODS]}
              value={[form.method]}
              onConfirm={(v) => set('method', String(v[0]))}
            >
              {(items, actions) => (
                <div onClick={() => actions.open()}>
                  <Input value={String(items[0]?.label ?? '等额本息')} readOnly />
                </div>
              )}
            </Picker>
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input placeholder="可选" value={form.note} onChange={(v) => set('note', v)} />
          </Form.Item>
        </Form>

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
