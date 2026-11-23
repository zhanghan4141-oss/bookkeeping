import { Module } from '@nestjs/common';
import { ExpensePlanController } from './expense-plan.controller.js';
import { ExpensePlanService } from './expense-plan.service.js';

@Module({
  controllers: [ExpensePlanController],
  providers: [ExpensePlanService],
  exports: [ExpensePlanService],
})
export class ExpensePlanModule {}