import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TasksController } from './tasks.controller.js';
import { ReminderTasksService } from './reminder-tasks.service.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [TasksController],
  providers: [ReminderTasksService],
})
export class TasksModule {}
