import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import { repaymentApi, settingsApi } from '../api/misc';
import type { ReminderSetting } from '../types';

const KIND = 'loan_reminder';

/** 稳定正整数 id：cuid 字符串 → 31 位正数（本地通知 id 必须是 number） */
function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

/** 清除所有已预约的还款提醒 */
async function clearReminderNotifications(): Promise<void> {
  const { notifications } = await LocalNotifications.getPending();
  const ours = notifications.filter(
    (n) => (n.extra as { kind?: string } | undefined)?.kind === KIND,
  );
  if (ours.length > 0) {
    await LocalNotifications.cancel({ notifications: ours });
  }
}

/** dueDate 当天 remindTime 的 Date；若该时刻已过则返回 null（跳过） */
function atTime(dueDate: string, remindTime: string): Date | null {
  const [y, m, d] = dueDate.split('-').map(Number);
  const [hh, mm] = remindTime.split(':').map(Number);
  const t = new Date(y, m - 1, d, hh, mm, 0);
  return t.getTime() > Date.now() ? t : null;
}

/**
 * 同步还款到期本地通知：清掉旧预约，按当前待还计划重排未来 leadDays 天内的提醒。
 * 在 App 启动/回到前台、以及标记已还等数据变更后调用（Web/PWA 直接跳过）。
 */
export async function syncReminderNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return;

    const setting = (await settingsApi.getReminder()).data as ReminderSetting;
    if (!setting.pushEnabled) {
      await clearReminderNotifications();
      return;
    }

    const days = Math.min(Math.max(setting.leadDays ?? 3, 1), 30);
    const remindTime = setting.remindTime ?? '08:00';
    const upcoming = (await repaymentApi.upcoming(days)).data;

    await clearReminderNotifications();

    const schedule: LocalNotificationSchema[] = [];
    for (const group of upcoming.daily ?? []) {
      const dueDate = group.date as string; // YYYY-MM-DD
      const at = atTime(dueDate, remindTime);
      if (!at) continue; // 当天且已过 remindTime，或过去日期
      for (const it of group.items ?? []) {
        schedule.push({
          id: hashId(it.repaymentId),
          title: '还款提醒',
          body: `「${it.loanName}」第${it.periodNo}期 应还 ${Number(it.remain).toFixed(2)} 元，${dueDate} 到期`,
          schedule: { at },
          extra: { kind: KIND, repaymentId: it.repaymentId },
        });
      }
    }

    if (schedule.length > 0) {
      await LocalNotifications.schedule({ notifications: schedule });
    }
  } catch (e) {
    // 本地通知失败不应影响正常使用
    console.warn('同步还款提醒失败', e);
  }
}
