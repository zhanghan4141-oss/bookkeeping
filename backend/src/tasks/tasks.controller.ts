import { Controller, Post } from '@nestjs/common';
import { ReminderTasksService } from './reminder-tasks.service.js';

@Controller('tasks')
export class TasksController {
  constructor(private readonly reminderTasks: ReminderTasksService) {}

  /** 手动触发还款提醒（测试用） */
  @Post('reminder/run')
  runReminder() {
    return this.reminderTasks.runNow();
  }
}
