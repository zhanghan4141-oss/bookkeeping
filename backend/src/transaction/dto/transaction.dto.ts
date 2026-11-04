import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateTransactionDto {
  @IsString()
  @IsNotEmpty({ message: '账本不能为空' })
  ledgerId!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsIn(['expense', 'income', 'transfer'])
  type!: 'expense' | 'income' | 'transfer';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: '金额必须大于 0' })
  @Type(() => Number)
  amount!: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsDateString()
  occurredAt!: string;
}

export class UpdateTransactionDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsIn(['expense', 'income', 'transfer'])
  type?: 'expense' | 'income' | 'transfer';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

export class QueryTransactionDto {
  @IsOptional()
  @IsString()
  month?: string; // YYYY-MM

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsIn(['expense', 'income', 'transfer'])
  type?: 'expense' | 'income' | 'transfer';

  @IsOptional()
  @IsString()
  keyword?: string;
}
