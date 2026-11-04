import { Module } from '@nestjs/common';
import { ImportExportController } from './import-export.controller.js';
import { ImportExportService } from './import-export.service.js';

@Module({
  controllers: [ImportExportController],
  providers: [ImportExportService],
  exports: [ImportExportService],
})
export class ImportExportModule {}
