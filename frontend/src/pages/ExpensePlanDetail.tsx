import { useContext, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Dialog, Input, List, NavBar, Popup, Toast } from 'antd-mobile';
import { TabActiveContext } from '../components/KeepAlive';
import { expensePlanApi } from '../api/expense';
import { ledgerApi } from '../api/ledger';
import { invalidateFinancialData } from '../lib/invalidate';
import { formatDate, formatMoney } from '../lib/format';
import { useBusy } from '../hooks/useBusy';
import { usePopupBack } from '../hooks/usePopupBack';
import type { ExpensePlan, ExpensePlanPeriod, Ledger } from '../types';

const FREQUENCY_LABEL: Record<string, string> = {
  month: '月',
  quarter: '季',
  year: '年',
};

export default function ExpensePlanDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pageRef = useRef<HTMLDivElement>(null);
  const isActive = useContext(TabActiveContext);
  // 标记支出弹窗状态
  const [paying, setPaying] = useState<ExpensePlanPeriod | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(() => formatDate(new Date()));
  // 逐期编辑（已支出期：一致可同步流水；提前标记的操作过期只改计划、流水冻结）
  const [editingPlan, setEditingPlan] = useState(false);
  const [editPeriods, setEditPeriods] = useState<
    { periodNo: number; dueDate: string; amount: string; status: string; diverged?: boolean; paidDate?: string | null }[]
  >([]);
  // 耗时操作按钮 loading
  const { busy: exportBusy, run: runExport } = useBusy();
  const { busy: deleteBusy, run: runDelete } = useBusy();
  const { busy: markBusy, run: runMark } = useBusy();

  usePopupBack(!!paying, () => setPaying(null));

  const { data: plan } = useQuery({
    queryKey: ['expense-plan', id],
    queryFn: async () => (await expensePlanApi.get(id)).data as ExpensePlan,
  });

  const { data: ledger } = useQuery({
    queryKey: ['ledger', plan?.ledgerId],
    queryFn: async () => (await ledgerApi.get(plan!.ledgerId)).data as Ledger,
    enabled: !!plan?.ledgerId,
  });
  const isViewer = ledger?.role === 'viewer';

  const handleMark = async () => {
    if (!paying) return;
    const amount = Number(payAmount);
    if (!payAmount || amount <= 0) {
      Toast.show({ content: '请输入支出金额' });
      return;
    }
    if (!payDate) {
      Toast.show({ content: '请选择支出日期' });
      return;
    }
    try {
      // 实际支出与计划金额不同 → 询问是否同步后续未支出期（计划金额跟随实际）
      let applyToFuture = false;
      if (amount !== Number(paying.amount)) {
        const ok = await new Promise<boolean>((resolve) => {
          Dialog.confirm({
            content: `实际支出 ¥${formatMoney(amount)} 与计划 ¥${formatMoney(Number(paying.amount))} 不同，是否将该金额同步到后续未支出期？`,
            cancelText: '仅本期',
            confirmText: '同步后续',
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
        applyToFuture = ok;
      }
      await expensePlanApi.mark(id, paying.periodNo, { amount, paidDate: payDate, applyToFuture });
      Toast.show({ content: '已标记支出' });
      setPaying(null);
      setPayAmount('');
      invalidateFinancialData(queryClient);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '操作失败' });
    }
  };

  const handleUndo = async (period: ExpensePlanPeriod) => {
    const ok = await new Promise<boolean>((resolve) => {
      Dialog.confirm({
        content: `撤销第${period.periodNo}期支出？撤销后该期流水将恢复为待支出。`,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    try {
      await expensePlanApi.undo(id, period.periodNo);
      Toast.show({ content: '已撤销' });
      invalidateFinancialData(queryClient);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '操作失败' });
    }
  };

  // 进入逐期编辑（已支出期回填原值、不可改，后端会校验）
  const startEditPlan = () => {
    if (!plan) return;
    setEditPeriods(
      plan.periods.map((p) => ({
        periodNo: p.periodNo,
        dueDate: p.dueDate.slice(0, 10),
        amount: String(p.amount),
        status: p.status,
        diverged: p.diverged,
        paidDate: p.paidDate,
      })),
    );
    setEditingPlan(true);
  };

  const saveEditPlan = async () => {
    if (editPeriods.some((p) => p.status !== 'paid' && (!p.dueDate || !p.amount))) {
      Toast.show({ content: '请完整填写每期日期和金额' });
      return;
    }
    try {
      await expensePlanApi.updatePeriods(
        id,
        editPeriods.map((p) => ({ periodNo: p.periodNo, dueDate: p.dueDate, amount: Number(p.amount) })),
      );
      Toast.show({ content: '已保存' });
      setEditingPlan(false);
      invalidateFinancialData(queryClient);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '保存失败' });
    }
  };

  // 导出支出计划（Excel）：走 axios 带 token 拉 blob 再下载（同导出还款计划）
  const handleExport = async () => {
    try {
      const res = await expensePlanApi.exportPlan(id);
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${plan?.name ?? '支出计划'}_支出计划.xlsx`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      Toast.show({ content: err.response?.data?.message ?? '导出失败' });
    }
  };

  // 删除支出计划（二次确认）
  const handleDelete = async () => {
    const ok = await new Promise<boolean>((resolve) => {
      Dialog.confirm({
        content: '确定删除该支出计划？删除后计划及其全部支出流水将删除，不可恢复。',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    try {
      await expensePlanApi.remove(id);
      Toast.show({ content: '已删除' });
      invalidateFinancialData(queryClient);
      navigate(-1);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '删除失败' });
    }
  };

  if (!plan) return null;

  const termText = plan.termCount > 0 ? `${plan.termCount} 期` : '不限';

  return (
    <div className="page" ref={pageRef}>
      <NavBar onBack={() => navigate(-1)} style={{ background: '#fff' }}>
        {plan.name}
      </NavBar>

      <div style={{ padding: 16 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', rowGap: 12, marginBottom: 12 }}>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>每期金额</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#52c41a' }}>
                ¥{formatMoney(Number(plan.periodAmount))}
              </div>
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>期数</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{termText}</div>
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>周期</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{FREQUENCY_LABEL[plan.frequency]}</div>
            </div>

            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>扣款日</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1677ff' }}>{plan.day} 号</div>
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>已支出</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                {plan.paidCount}/{plan.totalCount} 期 · ¥{formatMoney(plan.totalPaid)}
              </div>
            </div>
            <div>
              <div className="text-secondary" style={{ fontSize: 12 }}>待支出</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#ff8f1f' }}>
                ¥{formatMoney(plan.totalRemaining)}
              </div>
            </div>
          </div>
          <div className="text-secondary" style={{ fontSize: 13 }}>
            开始日期 {plan.startDate.slice(0, 10)} · 类别 {plan.category?.name ?? '—'} ·{' '}
            {plan.status === 'completed' ? '已完成' : plan.status === 'closed' ? '已关闭' : '进行中'}
          </div>
          {plan.note && (
            <div className="text-secondary" style={{ fontSize: 13, marginTop: 4, color: '#722ed1' }}>
              备注：{plan.note}
            </div>
          )}
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!isViewer && plan.status !== 'closed' && plan.status !== 'completed' && (
              <Button size="mini" fill="outline" onClick={() => navigate(`/expense-plans/${id}/edit`)}>
                编辑计划
              </Button>
            )}
            <Button size="mini" fill="outline" loading={exportBusy} onClick={() => runExport(handleExport)}>导出计划</Button>
            {!isViewer && (
              <Button size="mini" fill="outline" color="danger" loading={deleteBusy} onClick={() => runDelete(handleDelete)}>删除</Button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontWeight: 600 }}>支出计划</span>
          {!isViewer && plan.status !== 'closed' && plan.pendingCount > 0 && !editingPlan && (
            <Button size="mini" color="primary" fill="outline" onClick={startEditPlan}>
              编辑计划
            </Button>
          )}
        </div>

        {editingPlan ? (
          <div style={{ background: '#fff', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            {editPeriods.map((p) => {
              const isPaid = p.status === 'paid';
              const diverged = p.diverged === true;
              return (
                <div key={p.periodNo} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', background: diverged ? '#f9f0ff' : undefined, borderRadius: 6, padding: '4px 6px' }}>
                    <span style={{ width: 60, fontSize: 13, color: '#666', flexShrink: 0 }}>
                      第{p.periodNo}期{isPaid ? '✓' : ''}
                    </span>
                    <div style={{ width: 116, flexShrink: 0 }}>
                      <DatePicker
                        value={p.dueDate ? new Date(p.dueDate) : new Date()}
                        onConfirm={(v) => {
                          const d = formatDate(v);
                          setEditPeriods((prev) =>
                            prev.map((x) => (x.periodNo === p.periodNo ? { ...x, dueDate: d } : x)),
                          );
                        }}
                      >
                        {(_value, actions) => (
                          <div onClick={() => actions.open()} style={{ background: '#f5f5f5', borderRadius: 6, padding: '6px 8px', fontSize: 13, textAlign: 'center' }}>
                            {p.dueDate || '日期'}
                          </div>
                        )}
                      </DatePicker>
                    </div>
                    <span style={{ fontSize: 13, color: '#666', flexShrink: 0 }}>金额</span>
                    <Input
                      type="number"
                      value={p.amount}
                      onChange={(v) =>
                        setEditPeriods((prev) =>
                          prev.map((x) => (x.periodNo === p.periodNo ? { ...x, amount: v } : x)),
                        )
                      }
                      style={{ flex: 1, minWidth: 0, background: '#f5f5f5', borderRadius: 6, padding: '6px 8px', '--font-size': '13px' }}
                    />
                  </div>
                  {diverged && p.paidDate && (
                    <div style={{ fontSize: 11, color: '#a855f7', paddingLeft: 8, marginTop: 2 }}>
                      实际支出日 {p.paidDate.slice(0, 10)}
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button block fill="outline" onClick={() => setEditingPlan(false)}>取消</Button>
              <Button block color="primary" onClick={saveEditPlan}>保存</Button>
            </div>
          </div>
        ) : (
        <List style={{ borderRadius: 12, overflow: 'hidden' }}>
          {plan.periods.map((period) => {
            const isPaid = period.status === 'paid';
            const dd = period.dueDate.slice(0, 10);
            const pd = isPaid && period.paidDate ? period.paidDate.slice(0, 10) : null;
            // 标签：未支出=待支出；已支出按 vs 计划日期：同日=已支出，早于=提前支出，晚于（补记）=已支出
            const label = pd === null ? '待支出' : pd === dd ? '已支出' : pd < dd ? '提前支出' : '已支出';
            const color = pd === null ? '#1677ff' : pd < dd ? '#a855f7' : '#52c41a';
            return (
              <List.Item
                key={period.id}
                description={
                  <div style={{ fontSize: 12, marginTop: 2, color: '#999' }}>
                    金额 <span style={{ fontWeight: 600, color: '#000' }}>¥{formatMoney(Number(period.amount))}</span>
                    <span style={{ marginLeft: 8, color: '#ff8f1f' }}>{dd}</span>
                    {pd !== null && pd !== dd && (
                      <span style={{ marginLeft: 8, color: '#52c41a' }}>支出日 {pd}</span>
                    )}
                  </div>
                }
                extra={
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600 }}>¥{formatMoney(Number(period.amount))}</div>
                    <div style={{ fontSize: 12, color }}>{label}</div>
                  </div>
                }
              >
                第 {period.periodNo} 期
                {!isViewer && !isPaid && (
                  <Button
                    size="mini"
                    color="success"
                    fill="none"
                    style={{ marginLeft: 8 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPaying(period);
                      setPayAmount(String(period.amount));
                      setPayDate(formatDate(new Date()));
                    }}
                  >
                    标记支出
                  </Button>
                )}
                {!isViewer && isPaid && (
                  <Button size="mini" fill="none" style={{ marginLeft: 8 }} onClick={(e) => { e.stopPropagation(); handleUndo(period); }}>
                    撤销
                  </Button>
                )}
              </List.Item>
            );
          })}
        </List>
        )}
      </div>

      {/* 标记支出弹窗 */}
      <Popup
        visible={!!paying}
        onMaskClick={() => setPaying(null)}
        getContainer={() => pageRef.current ?? document.body}
        disableBodyScroll={isActive}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 8 }}>第 {paying?.periodNo} 期支出</h3>
          <div className="text-secondary" style={{ fontSize: 13, marginBottom: 16 }}>
            计划 ¥{paying ? formatMoney(Number(paying.amount)) : '0.00'}；实际支出金额可以不同
          </div>
          <div style={{ marginBottom: 16 }}>
            <div className="text-secondary" style={{ fontSize: 13, marginBottom: 4 }}>支出日期</div>
            <DatePicker
              precision="day"
              value={new Date(payDate)}
              max={new Date()}
              onConfirm={(v) => v && setPayDate(formatDate(v))}
            >
              {(value, actions) => (
                <div onClick={() => actions.open()} style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px' }}>
                  {value ? formatDate(value) : '选择日期'}
                </div>
              )}
            </DatePicker>
          </div>
          <Input
            type="number"
            placeholder="支出金额"
            value={payAmount}
            onChange={setPayAmount}
            style={{ fontSize: 24, marginBottom: 16 }}
          />
          <Button block color="success" loading={markBusy} onClick={() => runMark(handleMark)}>标记支出</Button>
        </div>
      </Popup>
    </div>
  );
}