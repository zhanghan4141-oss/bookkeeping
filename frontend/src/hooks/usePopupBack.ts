import { useEffect, useRef } from 'react';
import { pushOverlay } from '../lib/overlayStack';

/**
 * 弹窗打开时把「关闭函数」压入全局栈：Android 返回键优先关闭栈顶弹窗。
 * 用 ref 保存最新 close，避免 close 引用每次渲染变化导致嵌套弹窗栈序错乱。
 */
export function usePopupBack(visible: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!visible) return;
    return pushOverlay(() => closeRef.current());
  }, [visible]);
}
