import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { pushOverlay } from '../lib/overlayStack';

/**
 * 弹窗打开时把「关闭函数」压入全局栈：返回键（App 系统键 / web 浏览器后退手势）优先关闭栈顶弹窗。
 * 用 ref 保存最新 close，避免 close 引用每次渲染变化导致嵌套弹窗栈序错乱。
 * web：同时在 history 压入一个同 URL 占位，浏览器返回/手势会触发 popstate → App 优先关弹窗并抵消后退。
 */
export function usePopupBack(visible: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!visible) return;
    if (!Capacitor.isNativePlatform()) {
      // web：压入同 URL 占位，state 复制当前历史 state（保留 React Router 的 idx/key/usr）并加 __overlay 标记。
      // 返回键退到占位（__overlay=true）= 退页面、弹窗保留；再从占位退回普通条目 = 关弹窗。
      try {
        window.history.pushState(
          { ...(window.history.state ?? {}), __overlay: true },
          '',
          window.location.href,
        );
      } catch {
        // 受限环境不支持 pushState，忽略（App 原生走 backButton）
      }
    }
    return pushOverlay(() => closeRef.current());
  }, [visible]);
}
