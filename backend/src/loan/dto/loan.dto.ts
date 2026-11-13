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
  Min,
  ValidateNested,
} from 'class-validator';

export class CustomPeriodDto {
  @IsOptional()
  @IsIn(['period', 'prepay'])
  kind?: 'period' | 'prepay';

  @IsDateString()
  dueDate!: string;

  // 分账（kind=period）：本金 / 利息，合计 = 本金 + 利息
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  principal?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  interest?: number;

  // 合计（kind=prepay，或历史合并期仅给总额）
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  totalAmount?: number;
}

export class CreateLoanDto {
  @IsString()
  ledgerId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsIn(['borrow', 'lend'])
  direction?: 'borrow' | 'lend';

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  principal!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  annualRate!: number;

  @IsDateString()
  startDate!: string;

  @IsInt()
  @Min(1)
  @Max(360)
  @Type(() => Number)
  termMonths!: number;

  @IsInt()
  @Min(1)
  @Max(31)
  @Type(() => Number)
  repaymentDay!: number;

  @IsIn(['equal_installment', 'equal_principal', 'interest_first', 'custom'])
  repaymentMethod!: 'equal_installment' | 'equal_principal' | 'interest_first' | 'custom';

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomPeriodDto)
  customPeriods?: CustomPeriodDto[];
}

export class UpdateLoanDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['borrow', 'lend'])
  direction?: 'borrow' | 'lend';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  principal?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  annualRate?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(360)
  @Type(() => Number)
  termMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  @Type(() => Number)
  repaymentDay?: number;

  @IsOptional()
  @IsIn(['equal_installment', 'equal_principal', 'interest_first', 'custom'])
  repaymentMethod?: 'equal_installment' | 'equal_principal' | 'interest_first' | 'custom';

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsIn(['active', 'paid_off', 'closed'])
  status?: 'active' | 'paid_off' | 'closed';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomPeriodDto)
  customPeriods?: CustomPeriodDto[];
}

export class PayRepaymentDto {
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amount!: number; // 本次还款金额

  @IsOptional()
  @IsDateString()
  paidDate?: string;
}

export class PrepayDto {
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amount!: number; // 提前还的本金金额

  @IsDateString()
  prepayDate!: string; // 提前还款日期

  @IsOptional()
  @IsIn(['reduce_term', 'reduce_payment'])
  mode?: 'reduce_term' | 'reduce_payment'; // 部分提前还款方式：缩短期限 / 降低月供（默认降低月供）
}

export class UpdateRepaymentsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomPeriodDto)
  customPeriods!: CustomPeriodDto[];
}
