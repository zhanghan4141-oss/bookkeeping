import { IsBoolean, IsEmail, IsInt, IsOptional, Max, Min } from 'class-validator';

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
}
