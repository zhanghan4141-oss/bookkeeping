import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSpaceDto {
  @IsString()
  @MaxLength(191, { message: '空间名称不能超过 191 个字符' })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  color?: string;
}

export class UpdateSpaceDto {
  @IsOptional()
  @IsString()
  @MaxLength(191, { message: '空间名称不能超过 191 个字符' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  color?: string;
}