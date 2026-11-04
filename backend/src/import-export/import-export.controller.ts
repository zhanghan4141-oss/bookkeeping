import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { LedgerAccessService } from '../common/access/ledger-access.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { ImportExportService } from './import-export.service.js';

@Controller()
export class ImportExportController {
  constructor(
    private readonly service: ImportExportService,
    private readonly access: LedgerAccessService,
  ) {}

  @Get('ledgers/:ledgerId/transactions/export')
  async exportTransactions(
    @CurrentUser() user: AuthUser,
    @Param('ledgerId') ledgerId: string,
    @Query('month') month: string,
    @Res() res: Response,
  ) {
    await this.access.assertMember(ledgerId, user.id);
    const { buffer, filename } = await this.service.exportTransactions(
      ledgerId,
      month,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.send(buffer);
  }

  @Post('ledgers/:ledgerId/transactions/import')
  @UseInterceptors(FileInterceptor('file'))
  async importTransactions(
    @CurrentUser() user: AuthUser,
    @Param('ledgerId') ledgerId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.access.assertWritable(ledgerId, user.id);
    if (!file) throw new Error('请上传文件');
    return this.service.importTransactions(ledgerId, user.id, file.buffer);
  }

  @Get('loans/:id/export')
  async exportLoan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.exportLoan(id);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.send(buffer);
  }

  @Post('loans/:id/import')
  @UseInterceptors(FileInterceptor('file'))
  async importLoan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new Error('请上传文件');
    return this.service.importLoan(id, file.buffer);
  }
}
