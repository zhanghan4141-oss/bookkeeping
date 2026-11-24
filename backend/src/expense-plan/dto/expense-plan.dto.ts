import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateExpensePlanDto {
  @IsString()
  ledgerId!: string;

  /** 支出类别（用户自选，不按计划名自动建） */
  @IsString()
  categoryId!: string;

  @IsString()
  @MaxLength(191, { message: '计划名称不能超过 191 个字符' })
  name!: string;

  /** 每期金额 */
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  periodAmount!: number;

  /** 期数；0 = 不限（生成 120 期） */
  @IsInt()
  @Min(0)
  @Max(360)
  @Type(() => Number)
  termCount!: number;

  @IsIn(['month', 'quarter', 'year'])
  frequency!: 'month' | 'quarter' | 'year';

  @IsDateString()
  startDate!: string;

  /** 每周期扣款日 1-31（季/年默认 = startDate 的 day） */
  @IsInt()
  @Min(1)
  @Max(31)
  @Type(() => Number)
  day!: number;

  @IsOptional()
  @IsString()
  @MaxLength(191, { message: '备注不能超过 191 个字符' })
  note?: string;
}

export class UpdateExpensePlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(191, { message: '计划名称不能超过 191 个字符' })
  name?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  periodAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(360)
  @Type(() => Number)
  termCount?: number;

  @IsOptional()
  @IsIn(['month', 'quarter', 'year'])
  frequency?: 'month' | 'quarter' | 'year';

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  @Type(() => Number)
  day?: number;

  @IsOptional()
  @IsIn(['active', 'completed', 'closed'])
  status?: 'active' | 'completed' | 'closed';

  @IsOptional()
  @IsString()
  @MaxLength(191, { message: '备注不能超过 191 个字符' })
  note?: string;
}

export class MarkPeriodDto {
  /** 实际支出金额（缺省 = 计划金额）；≠ 计划值时仅记实际，不改计划 */
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount?: number;

  @IsOptional()
  @IsDateString()
  paidDate?: string;
}

export class UpdateExpensePlanPeriodDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  periodNo!: number;

  @IsDateString()
  dueDate!: string;

  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  amount!: number;
}

/** 逐期编辑（镜像贷款 updateRepayments：已支出期不可改日期/金额） */
export class UpdateExpensePlanPeriodsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateExpensePlanPeriodDto)
  periods!: UpdateExpensePlanPeriodDto[];
}