import { useState } from 'react';

interface ExpandableNoteProps {
  /** 备注文本；为空时不渲染（等价于旧 `t.note && <span/>`） */
  text?: string | null;
}

/**
 * 可展开/收起的流水备注：统一以「备注：」前缀展示，单行截断，点击展开完整内容，再点收起。
 * 组件内部 useState 各自管理 → 每条流水的展开态独立，互不影响。
 * onClick 内 stopPropagation，避免触发行级 openEdit / 〔贷款名〕跳转。
 */
export default function ExpandableNote({ text }: ExpandableNoteProps) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;

  const content = `备注：${text}`;
  const base = {
    marginLeft: 6,
    color: '#722ed1',
    display: 'inline-block',
    maxWidth: '100%',
    verticalAlign: 'bottom',
    cursor: 'pointer',
  };

  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        setExpanded((v) => !v);
      }}
      style={
        expanded
          ? { ...base, whiteSpace: 'normal' as const, wordBreak: 'break-all' as const }
          : { ...base, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }
      }
    >
      {content}
    </span>
  );
}