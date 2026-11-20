/** 全局请求 pending 计数器（仅统计写请求，避免 GET 查询闪圈） */
let pending = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

export const beginRequest = () => {
  pending += 1;
  emit();
};
export const endRequest = () => {
  pending = Math.max(0, pending - 1);
  emit();
};
export const getPending = () => pending;
/** 订阅 pending 变化，返回取消订阅函数 */
export const onPendingChange = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};