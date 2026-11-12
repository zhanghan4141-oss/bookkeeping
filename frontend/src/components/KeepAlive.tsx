import { createContext, useRef, type ReactNode } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';

/** 需要保活的顶层 Tab 页面路径（这些页面不使用路由参数，可安全保活） */
const TAB_PATHS = ['/ledgers', '/repayments', '/stats', '/settings'];

/**
 * 当前 Tab 是否处于激活（可见）状态。
 * keep-alive 隐藏页面时，弹窗需要据此关闭 body 滚动锁，否则跳转后页面无法滚动。
 */
export const TabActiveContext = createContext(true);

/**
 * 轻量 KeepAlive：让 Tab 页面在跳转后不卸载、只隐藏，返回时原样恢复
 * （滚动位置、弹窗、展开状态等）。子页面（带参数的路由）不保活。
 */
export default function KeepAlive() {
  const outlet = useOutlet();
  const { pathname } = useLocation();
  const cacheRef = useRef<Map<string, ReactNode>>(new Map());

  const isTab = TAB_PATHS.includes(pathname);

  // 首次进入某个 Tab 页面时缓存其 outlet 元素
  if (isTab && !cacheRef.current.has(pathname)) {
    cacheRef.current.set(pathname, outlet);
  }

  return (
    <>
      {Array.from(cacheRef.current.entries()).map(([path, node]) => (
        <div key={path} style={{ display: path === pathname ? 'block' : 'none' }}>
          <TabActiveContext.Provider value={path === pathname}>
            {node}
          </TabActiveContext.Provider>
        </div>
      ))}
      {!isTab && <div key={`sub-${pathname}`}>{outlet}</div>}
    </>
  );
}
