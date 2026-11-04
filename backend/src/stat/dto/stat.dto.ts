import { IsIn, IsOptional, IsString } from 'class-validator';

export class SummaryQueryDto {
  @IsOptional()
  @IsIn(['month', 'year'])
  period?: 'month' | 'year';

  @IsOptional()
  @IsIn(['solar', 'lunar'])
  calendar?: 'solar' | 'lunar';

  @IsOptional()
  @IsString()
  date?: string; // 参考日期 YYYY-MM-DD，用于确定统计范围；缺省=当前月/年

  @IsOptional()
  @IsString()
  ledgerIds?: string; // 逗号分隔的多账本
}
