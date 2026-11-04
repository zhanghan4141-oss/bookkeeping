import { Module } from '@nestjs/common';
import { StatController } from './stat.controller.js';
import { StatService } from './stat.service.js';

@Module({
  controllers: [StatController],
  providers: [StatService],
  exports: [StatService],
})
export class StatModule {}
