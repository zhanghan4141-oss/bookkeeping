import { useEffect, useState } from 'react';
import { SpinLoading } from 'antd-mobile';
import { useIsFetching } from '@tanstack/react-query';
import { getPending, onPendingChange } from '../lib/requestPending';

/**
 * 全局加载覆盖层：读请求「首次加载」（尚无缓存数据）或写请求在途时显示转圈。
 * - 读数据：仅 status=pending（无数据）且正在 fetch 时显示，后台刷新（有旧数据）不闪圈
 * - 写数据：axios 拦截器计数的 pending 数
 */
export default function GlobalLoading() {
  // 首次加载中的读请求数（useIsFetching 只统计 fetchStatus=fetching 的 query，再用 predicate 过滤无数据态）
  const pendingReads = useIsFetching({
    predicate: (q) => q.state.status === 'pending',
  });
  const [writePending, setWritePending] = useState(getPending());
  useEffect(() => {
    setWritePending(getPending());
    return onPendingChange(() => setWritePending(getPending()));
  }, []);

  const show = pendingReads > 0 || writePending > 0;
  if (!show) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.03)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 999,
      }}
    >
      <SpinLoading style={{ fontSize: 24, color: 'var(--primary)' }} />
    </div>
  );
}