import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateLedgerDto {
  @IsString()
  @IsNotEmpty({ message: '账本名称不能为空' })
  name!: string;

  @IsIn(['daily', 'loan', 'custom'])
  type!: 'daily' | 'loan' | 'custom';

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  currency?: string;
}

export class UpdateLedgerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  currency?: string;
}

export class AddMemberDto {
  @IsString()
  @IsNotEmpty({ message: '邮箱不能为空' })
  email!: string;

  // 不能添加 owner（所有权只能通过转让产生，账本恒一名 owner）
  @IsIn(['editor', 'viewer'])
  role!: 'editor' | 'viewer';
}

export class UpdateMemberDto {
  @IsIn(['editor', 'viewer'])
  role!: 'editor' | 'viewer';
}
