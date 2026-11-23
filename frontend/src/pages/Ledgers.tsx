import { Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, List, NavBar, Picker, Popup, Toast } from 'antd-mobile';
import { AddCircleOutline } from 'antd-mobile-icons';
import { ledgerApi } from '../api/ledger';
import { statApi } from '../api/misc';
import { invalidateFinancialData } from '../lib/invalidate';
import { useLedgerSelectionStore } from '../stores/ledgerSelection';
import { useHomeLedgerSelection } from '../stores/homeLedgerSelection';
import { useLedgerPeriodStore } from '../stores/ledgerPeriod';
import { useSpaceSelection } from '../stores/spaceSelection';
import { TabActiveContext } from '../components/KeepAlive';
import SpaceDrawer from '../components/SpaceDrawer';
import { spaceApi } from '../api/space';
import type { Ledger, LedgerSummary, StatOverview, UserSpace } from '../types';
import { formatMoney } from '../lib/format';

const LEDGER_TYPE_ICON: Record<string, string> = {
  daily: '📒',
  loan: '💰',
  custom: '📁',
};

const OVERVIEW_BUCKETS = [
  { key: 'day', label: '当日' },
  { key: 'month', label: '当月' },
  { key: 'year', label: '当年' },
  { key: 'all', label: '所有' },
] as const;

export default function Ledgers() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pageRef = useRef<HTMLDivElement>(null);
  const isActive = useContext(TabActiveContext);
  const [showCreate, setShowCreate] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const period = useLedgerPeriodStore((s) => s.period);
  const setPeriod = useLedgerPeriodStore((s) => s.setPeriod);
  const selectedIds = useLedgerSelectionStore((s) => s.selectedIds);
  const selectOne = useLedgerSelectionStore((s) => s.selectOne);

  const { data: ledgers = [] } = useQuery({
    queryKey: ['ledgers'],
    queryFn: async () => (await ledgerApi.list()).data as Ledger[],
  });

  const { data: summaries = [] } = useQuery({
    queryKey: ['ledger-summaries', period],
    queryFn: async () => (await statApi.ledgerSummaries(period)).data as LedgerSummary[],
  });

  const summaryMap = useMemo(() => {
    const m = new Map<string, LedgerSummary>();
    summaries.forEach((s) => m.set(s.ledgerId, s));
    return m;
  }, [summaries]);

  // 顶部矩阵：当日/当月/当年/所有 四维度的所有账本合计
  const statsDeselectedIds = useHomeLedgerSelection((s) => s.deselectedIds);
  const toggleStatsCheck = useHomeLedgerSelection((s) => s.toggle);

  // ===== 空间分组（个人私有；默认分组 = 共享账本 + 我拥有但未归类）=====
  const selectedSpaceId = useSpaceSelection((s) => s.selectedSpaceId);
  const setSpace = useSpaceSelection((s) => s.setSpace);

  const { data: spaces = [] } = useQuery({
    queryKey: ['spaces'],
    queryFn: async () => (await spaceApi.list()).data as UserSpace[],
  });

  // persist 兜底：选中的空间已被删除 → 归默认分组（只做一次）
  const spaceIdSet = useMemo(() => new Set(spaces.map((s) => s.id)), [spaces]);
  const effSpaceId =
    selectedSpaceId && spaceIdSet.has(selectedSpaceId) ? selectedSpaceId : null;
  useEffect(() => {
    if (selectedSpaceId && spaces.length > 0 && !spaceIdSet.has(selectedSpaceId)) {
      setSpace(null);
    }
  }, [selectedSpaceId, spaces, spaceIdSet]);

  const spaceMatches = (l: Ledger, spaceId: string | null): boolean => {
    const owned = l.role === 'owner';
    if (!owned) return spaceId === null; // 共享账本恒默认分组
    if (spaceId === null) return !l.spaceId; // 我拥有且未归类
    return l.spaceId === spaceId;
  };
  const filteredLedgers = ledgers.filter((l) => spaceMatches(l, effSpaceId));
  const defaultCount = ledgers.filter((l) => spaceMatches(l, null)).length;
  const currentSpace = spaces.find((s) => s.id === effSpaceId);
  const currentSpaceName = effSpaceId ? currentSpace?.name ?? '默认分组' : '默认分组';
  const currentSpaceIcon = effSpaceId ? currentSpace?.icon ?? '🗂️' : '📂';

  // 选中空间的账本集合 → 未勾选 ∪ 不属于空间 → 排除（统计只看当前空间 ∩ 勾选）
  const { data: overview } = useQuery({
    queryKey: ['stats', 'overview', effSpaceId ?? 'default', statsDeselectedIds.join(',')],
    queryFn: async () => {
      const inSpaceIds = new Set(filteredLedgers.map((l) => l.id));
      const excludeIds = ledgers
        .filter((l) => !inSpaceIds.has(l.id) || statsDeselectedIds.includes(l.id))
        .map((l) => l.id);
      return (await statApi.overview(excludeIds)).data as StatOverview;
    },
  });

  // 选中的账本排最上方（在当前空间内）
  const sortedLedgers = useMemo(() => {
    return [...filteredLedgers].sort((a, b) => {
      const aSel = selectedIds.includes(a.id) ? 1 : 0;
      const bSel = selectedIds.includes(b.id) ? 1 : 0;
      return bSel - aSel;
    });
  }, [filteredLedgers, selectedIds]);

  const handleCreate = async (values: { name: string; type: string[]; spaceId?: string[] }) => {
    try {
      await ledgerApi.create({
        name: values.name,
        type: values.type[0],
        spaceId: values.spaceId?.[0] || undefined,
      });
      Toast.show({ content: '创建成功' });
      setShowCreate(false);
      // 失效账本列表与空间（抽屉计数/归属）缓存，立即显示新建账本
      queryClient.invalidateQueries({ queryKey: ['ledgers'] });
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      invalidateFinancialData(queryClient);
    } catch (e: any) {
      Toast.show({ content: e.response?.data?.message ?? '创建失败' });
    }
  };

  const handleOpenLedger = (l: Ledger) => {
    selectOne(l.id);
    navigate(`/ledgers/${l.id}`);
  };

  return (
    <div className="page" ref={pageRef}>
      <NavBar
        back={null}
        style={{ background: '#fff' }}
        left={
          <div
            onClick={() => setDrawerOpen((v) => !v)}
            style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <span style={{ fontSize: 16 }}>{currentSpaceIcon}</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{currentSpaceName}</span>
            <span style={{ fontSize: 12, color: '#999' }}>▾</span>
          </div>
        }
      >
        记账本
      </NavBar>

      <div style={{ padding: '16px' }}>
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            padding: '16px 20px',
            marginBottom: 16,
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '36px repeat(3, minmax(0, 1fr))',
                alignItems: 'center',
                rowGap: 8,
                columnGap: 4,
                minWidth: 300,
              }}
            >
              {/* 表头：收 / 支 / 余 */}
              <div />
              <div className="text-secondary" style={{ fontSize: 12, textAlign: 'center' }}>收</div>
              <div className="text-secondary" style={{ fontSize: 12, textAlign: 'center' }}>支</div>
              <div className="text-secondary" style={{ fontSize: 12, textAlign: 'center' }}>余</div>

              {/* 行：当日 / 当月 / 当年 / 所有 */}
              {OVERVIEW_BUCKETS.map((b) => {
                const s = overview?.[b.key];
                return (
                  <Fragment key={b.key}>
                    <div className="text-secondary" style={{ fontSize: 12 }}>{b.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#52c41a', textAlign: 'center', whiteSpace: 'nowrap', overflowX: 'auto' }}>
                      ¥{formatMoney(s?.income ?? 0)}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#ff4d4f', textAlign: 'center', whiteSpace: 'nowrap', overflowX: 'auto' }}>
                      ¥{formatMoney(s?.expense ?? 0)}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1677ff', textAlign: 'center', whiteSpace: 'nowrap', overflowX: 'auto' }}>
                      ¥{formatMoney(s?.surplus ?? 0)}
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 16 }}>我的账本</span>
          <Button
            size="mini"
            color="primary"
            fill="outline"
            onClick={() => setShowCreate(true)}
          >
            <AddCircleOutline /> 新建
          </Button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {OVERVIEW_BUCKETS.map((t) => (
            <div
              key={t.key}
              onClick={() => setPeriod(t.key)}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '6px 0',
                borderRadius: 6,
                fontSize: 13,
                background: period === t.key ? '#1677ff' : '#f5f5f5',
                color: period === t.key ? '#fff' : '#666',
              }}
            >
              {t.label}
            </div>
          ))}
        </div>

        <List style={{ borderRadius: 12, overflow: 'hidden' }}>
          {sortedLedgers.map((l) => {
            const isSelected = selectedIds.includes(l.id);
            const s = summaryMap.get(l.id);
            return (
              <List.Item
                key={l.id}
                prefix={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={!statsDeselectedIds.includes(l.id)}
                      readOnly
                      style={{ width: 20, height: 20, pointerEvents: 'none' }}
                    />
                    <span style={{ fontSize: 28 }}>
                      {l.icon || LEDGER_TYPE_ICON[l.type] || '📒'}
                    </span>
                  </div>
                }
                description={
                  <div>
                    <div className="text-secondary" style={{ fontSize: 12 }}>
                      {l.type === 'loan' ? '贷款账本' : l.type === 'daily' ? '日常账本' : '自定义'} · {l.currency}
                    </div>
                    <div style={{ fontSize: 12, marginTop: 2 }}>
                      收 <span style={{ color: '#52c41a' }}>¥{formatMoney(s?.income ?? 0)}</span>
                      {'  '}支 <span style={{ color: '#ff4d4f' }}>¥{formatMoney(s?.expense ?? 0)}</span>
                      {'  '}结余{' '}
                      <span style={{ color: '#1677ff' }}>
                        ¥{formatMoney(s?.surplus ?? 0)}
                      </span>
                    </div>
                  </div>
                }
                onClick={(e) => {
                  // 左侧 38px 内为勾选热区（整行高、贴左缘、止于图标附近）；
                  // 统一在行自身点击里按坐标判定，不依赖额外覆盖层（避免事件被吞）
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  if (x <= 38) toggleStatsCheck(l.id);
                  else handleOpenLedger(l);
                }}
                style={
                  isSelected
                    ? { background: '#e6f4ff' }
                    : undefined
                }
                extra={isSelected ? <span style={{ color: '#1677ff', fontSize: 13 }}>当前</span> : undefined}
              >
                {l.name}
                {(l.memberCount ?? 1) > 1 && (
                  <span style={{ marginLeft: 6, fontSize: 12, color: '#999' }}>
                    👥 {l.memberCount}
                  </span>
                )}
              </List.Item>
            );
          })}
          {ledgers.length === 0 && (
            <List.Item description="点击右上角新建账本开始记账">暂无账本</List.Item>
          )}
        </List>
      </div>

      <Popup
        visible={showCreate}
        onMaskClick={() => setShowCreate(false)}
        getContainer={() => pageRef.current ?? document.body}
        disableBodyScroll={isActive}
        bodyStyle={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 16 }}>新建账本</h3>
          <Form
            layout="vertical"
            onFinish={handleCreate}
            initialValues={{ type: ['daily'], spaceId: effSpaceId ? [effSpaceId] : undefined }}
            footer={
              <Button block type="submit" color="primary">
                创建
              </Button>
            }
          >
            <Form.Item name="name" label="账本名称" rules={[{ required: true, message: '请输入名称' }]}>
              <Input placeholder="如：家庭日常" />
            </Form.Item>
            <Form.Item name="type" label="类型" trigger="onConfirm">
              <Picker
                columns={[
                  [
                    { label: '日常账本', value: 'daily' },
                    { label: '贷款账本', value: 'loan' },
                    { label: '自定义', value: 'custom' },
                  ],
                ]}
              >
                {(items, actions) => (
                  <div onClick={() => actions.open()}>
                    <Input value={String(items[0]?.label ?? '日常账本')} readOnly />
                  </div>
                )}
              </Picker>
            </Form.Item>
            <Form.Item name="spaceId" label="空间" trigger="onConfirm">
              <Picker
                columns={[
                  [
                    { label: '默认分组', value: '' },
                    ...spaces.map((s) => ({ label: s.name, value: s.id })),
                  ],
                ]}
              >
                {(items, actions) => (
                  <div onClick={() => actions.open()}>
                    <Input value={String(items[0]?.label ?? '默认分组')} readOnly />
                  </div>
                )}
              </Picker>
            </Form.Item>
          </Form>
        </div>
      </Popup>

      {/* 左侧空间抽屉 */}
      <SpaceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        spaces={spaces}
        defaultCount={defaultCount}
        currentSpaceId={effSpaceId}
        ledgers={ledgers}
        onSelect={(id) => {
          setSpace(id);
          setDrawerOpen(false);
        }}
      />
    </div>
  );
}
