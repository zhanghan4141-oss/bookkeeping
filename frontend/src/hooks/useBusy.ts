import { useState } from 'react';

/** 给异步动作加按钮 loading 状态；run 里先渲染 loading 再执行，防止连续点击 */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 50));
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}