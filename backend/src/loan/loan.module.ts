import { Module } from '@nestjs/common';
import { LoanController } from './loan.controller.js';
import { LoanService } from './loan.service.js';

@Module({
  controllers: [LoanController],
  providers: [LoanService],
  exports: [LoanService],
})
export class LoanModule {}
