import { Module } from '@nestjs/common';
import { RepaymentController } from './repayment.controller.js';
import { RepaymentService } from './repayment.service.js';

@Module({
  controllers: [RepaymentController],
  providers: [RepaymentService],
  exports: [RepaymentService],
})
export class RepaymentModule {}
