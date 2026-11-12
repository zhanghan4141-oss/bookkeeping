import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { AccessModule } from './common/access/access.module.js';
import { AuditLogModule } from './audit-log/audit-log.module.js';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor.js';
import { MailModule } from './common/mail/mail.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { CategoryModule } from './category/category.module.js';
import { ImportExportModule } from './import-export/import-export.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { LoanModule } from './loan/loan.module.js';
import { NotificationModule } from './notification/notification.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RepaymentModule } from './repayment/repayment.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { StatModule } from './stat/stat.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { TransactionModule } from './transaction/transaction.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({}),
    PrismaModule,
    AccessModule,
    MailModule,
    AuthModule,
    LedgerModule,
    CategoryModule,
    TransactionModule,
    LoanModule,
    RepaymentModule,
    NotificationModule,
    SettingsModule,
    StatModule,
    ImportExportModule,
    TasksModule,
    AuditLogModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestContextInterceptor,
    },
  ],
})
export class AppModule {}
