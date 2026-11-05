import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

/**
 * 和 useState 一样，但会持久化到 localStorage。
 * 刷新页面时从 localStorage 恢复上次填写的内容（表单草稿不丢失）。
 * 返回 [state, setState, clear]，clear 用于提交成功后清除草稿。
 */
export function usePersistedState<T>(
  key: string,
  initialValue: T | (() => T),
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) return JSON.parse(raw) as T;
    } catch {
      // ignore，回退到默认值
    }
    return typeof initialValue === 'function'
      ? (initialValue as () => T)()
      : initialValue;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // 隐私模式/存储被禁用时忽略
    }
  }, [key, state]);

  const clear = () => {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  };

  return [state, setState, clear];
}
