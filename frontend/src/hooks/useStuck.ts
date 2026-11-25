import { useEffect, useRef, useState } from 'react';

/**
 * 检测 sticky 元素是否已「固定」（顶部到达 sticky top）。
 * 用 scroll + getBoundingClientRect：固定后元素 top 停在 topOffset，否则仍在文档流下方。
 * @param topOffset sticky 的 top 值（像素，不含 safe-area 等，传最终值）
 * @param scrollContainer 可选：滚动容器（默认 window；弹窗内滚动传容器元素）
 */
export function useStuck<T extends HTMLElement>(
  topOffset: number,
  scrollContainer?: () => HTMLElement | null,
) {
  const ref = useRef<T | null>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const container = scrollContainer?.() ?? window;
    const check = () => {
      if (!el) return;
      setStuck(el.getBoundingClientRect().top <= topOffset);
    };
    check();
    container.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      container.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [topOffset, scrollContainer]);

  return { ref, stuck };
}