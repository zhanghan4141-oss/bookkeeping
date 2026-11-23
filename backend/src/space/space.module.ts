import { Module } from '@nestjs/common';
import { SpaceController } from './space.controller.js';
import { SpaceService } from './space.service.js';

@Module({
  controllers: [SpaceController],
  providers: [SpaceService],
  exports: [SpaceService],
})
export class SpaceModule {}