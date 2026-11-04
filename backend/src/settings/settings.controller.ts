import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/decorators/current-user.decorator.js';
import { UpdateReminderSettingDto } from './dto/settings.dto.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('reminder')
  getReminder(@CurrentUser() user: AuthUser) {
    return this.settingsService.getReminder(user.id);
  }

  @Patch('reminder')
  updateReminder(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateReminderSettingDto,
  ) {
    return this.settingsService.updateReminder(user.id, dto);
  }
}
