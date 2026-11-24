type Close = () => void;

const stack: Close[] = [];

/**
 * 压入一个「关闭函数」，返回注销函数（弹窗关闭/卸载时调用）。
 */
export function pushOverlay(close: Close): () => void {
  stack.push(close);
  return () => {
    const i = stack.lastIndexOf(close);
    if (i >= 0) stack.splice(i, 1);
  };
}

/**
 * 关闭栈顶弹窗；有关闭动作返回 true（调用方应吞掉本次返回事件）。
 */
export function closeTopOverlay(): boolean {
  const close = stack[stack.length - 1];
  if (close) {
    close();
    return true;
  }
  return false;
}
