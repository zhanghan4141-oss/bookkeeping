import { useQuery } from '@tanstack/react-query';
import { Badge, Button, List, NavBar, Toast } from 'antd-mobile';
import { notificationApi } from '../api/misc';
import type { Notification } from '../types';

export default function Notifications() {
  const { data, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await notificationApi.list()).data,
  });

  const items: Notification[] = data?.items ?? [];
  const unread = data?.unreadCount ?? 0;

  const markRead = async (id: string) => {
    await notificationApi.markRead(id);
    refetch();
  };

  const markAll = async () => {
    await notificationApi.markAllRead();
    Toast.show({ content: '已全部标记已读' });
    refetch();
  };

  return (
    <div className="page">
      <NavBar
        back={null}
        style={{ background: '#fff' }}
        right={
          <Button size="mini" fill="none" onClick={markAll} disabled={unread === 0}>
            全部已读
          </Button>
        }
      >
        提醒中心
      </NavBar>

      <div style={{ padding: 16 }}>
        <List style={{ borderRadius: 12, overflow: 'hidden' }}>
          {items.map((n) => (
            <List.Item
              key={n.id}
              prefix={
                <Badge content={n.isRead ? null : Badge.dot} style={{ marginRight: 4 }}>
                  <span style={{ fontSize: 18 }}>
                    {n.type === 'overdue' ? '🔴' : n.type === 'loan_reminder' ? '⏰' : '📢'}
                  </span>
                </Badge>
              }
              description={
                <div style={{ fontSize: 13, color: '#666', marginTop: 4, whiteSpace: 'pre-wrap' }}>
                  {n.content}
                  <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                    {new Date(n.createdAt).toLocaleString('zh-CN')}
                  </div>
                </div>
              }
              onClick={() => !n.isRead && markRead(n.id)}
            >
              <span style={{ fontWeight: n.isRead ? 400 : 600 }}>{n.title}</span>
            </List.Item>
          ))}
          {items.length === 0 && (
            <List.Item description="暂无提醒">暂无提醒</List.Item>
          )}
        </List>
      </div>
    </div>
  );
}
