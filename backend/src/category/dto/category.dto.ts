import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty({ message: '类别名称不能为空' })
  name!: string;

  @IsIn(['expense', 'income'])
  type!: 'expense' | 'income';

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['expense', 'income'])
  type?: 'expense' | 'income';

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class RemoveCategoryDto {
  /** 流水迁移目标类别 id（同类型）；null/缺省 = 变为未分类 */
  @IsOptional()
  @IsString()
  targetCategoryId?: string | null;
}
