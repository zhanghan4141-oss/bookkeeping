import { IsBoolean, IsEmail, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class UpdateReminderSettingDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  leadDays?: number;

  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;

  @IsOptional()
  @IsBoolean()
  inappEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: '提醒时间格式不正确' })
  remindTime?: string;
}
