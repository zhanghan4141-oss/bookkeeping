import { createContext, useRef, type ReactNode } from 'react';
import { matchPath, useLocation, useOutlet } from 'react-router-dom';

/** 需要保活的顶层 Tab 页面路径（这些页面不使用路由参数，可安全保活） */
const TAB_PATHS = ['/ledgers', '/repayments', '/stats', '/settings'];

/**
 * 需要保活的「数据浏览/详情类」子页路径模式。
 * 表单/编辑/登录页（/login、/ledgers/:id/record、/ledgers/:ledgerId/loans/new、
 * /loans/:id/edit）不在列表中，matchPath 精确匹配时对多一段的路径天然不命中。
 */
const KEEP_ALIVE_PATTERNS = [
  '/ledgers/:id',            // 账本详情
  '/ledgers/:id/loans',      // 贷款列表
  '/ledgers/:id/categories', // 类别
  '/ledgers/:id/members',    // 成员
  '/loans/:id',              // 贷款详情
  '/notifications',          // 提醒中心
  '/settings/ledgers',       // 账本管理
  '/settings/audit-logs',    // 日志查询
];

/** 保活条数上限：带参数子页按真实 pathname 各自缓存，会随访问累积；超出裁剪最久未访问条目 */
const MAX_KEEP_ALIVE = 20;

/** pathname 是否命中任一保活子页模式 */
function isMatchedSubPage(pathname: string): boolean {
  return KEEP_ALIVE_PATTERNS.some((p) => matchPath(p, pathname));
}

/**
 * 当前 Tab 是否处于激活（可见）状态。
 * keep-alive 隐藏页面时，弹窗需要据此关闭 body 滚动锁，否则跳转后页面无法滚动。
 */
export const TabActiveContext = createContext(true);

/**
 * 轻量 KeepAlive：
 * - 4 个 Tab + 若干「数据浏览/详情类」子页在跳转后不卸载、只隐藏，返回时原样恢复
 *   （滚动位置、弹窗、展开状态、搜索词、备注展开态等）。
 * - 缓存 key 为真实 pathname（/ledgers/a 与 /ledgers/b 各自独立、互不串数据）。
 * - keep-alive 隐藏页面时 TabActiveContext 为 false，弹窗据此关闭 body 滚动锁。
 * - 超出 MAX_KEEP_ALIVE 时按插入序（Map 保持顺序）裁剪最久未访问的非 Tab 条目；
 *   Tab 永久保留，不破坏现有 4 Tab 保活逻辑。
 */
export default function KeepAlive() {
  const outlet = useOutlet();
  const { pathname } = useLocation();
  const cacheRef = useRef<Map<string, ReactNode>>(new Map());

  const isTab = TAB_PATHS.includes(pathname);
  const isSubPage = isMatchedSubPage(pathname);
  const isKeepAlive = isTab || isSubPage;

  if (isKeepAlive) {
    if (cacheRef.current.has(pathname)) {
      // LRU touch：已缓存 → 移到 Map 末尾（最新访问）。值不变，保持首访元素/组件状态
      const node = cacheRef.current.get(pathname)!;
      cacheRef.current.delete(pathname);
      cacheRef.current.set(pathname, node);
    } else {
      cacheRef.current.set(pathname, outlet);
    }
  }

  // 裁剪：超过上限时删除最旧的非 Tab 条目
  if (cacheRef.current.size > MAX_KEEP_ALIVE) {
    for (const k of Array.from(cacheRef.current.keys())) {
      if (cacheRef.current.size <= MAX_KEEP_ALIVE) break;
      if (!TAB_PATHS.includes(k)) cacheRef.current.delete(k);
    }
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
      {!isKeepAlive && <div key={`sub-${pathname}`}>{outlet}</div>}
    </>
  );
}