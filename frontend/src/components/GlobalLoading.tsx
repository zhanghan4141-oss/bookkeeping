import { useEffect, useState } from 'react';
import { SpinLoading } from 'antd-mobile';
import { getPending, onPendingChange } from '../lib/requestPending';

/** 全局加载覆盖层：写请求在途时显示极浅转圈，作为按钮级 loading 之外的兜底 */
export default function GlobalLoading() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const off = onPendingChange(() => setShow(getPending() > 0));
    return off;
  }, []);
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
      <SpinLoading style={{ fontSize: 24, color: '#1677ff' }} />
    </div>
  );
}