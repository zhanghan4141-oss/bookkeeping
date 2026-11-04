import { Global, Module } from '@nestjs/common';
import { LedgerAccessService } from './ledger-access.service.js';

@Global()
@Module({
  providers: [LedgerAccessService],
  exports: [LedgerAccessService],
})
export class AccessModule {}
