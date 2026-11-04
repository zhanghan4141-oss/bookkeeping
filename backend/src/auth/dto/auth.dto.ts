import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  @IsString()
  @MinLength(6, { message: '密码至少 6 位' })
  password!: string;

  @IsNotEmpty({ message: '昵称不能为空' })
  @IsString()
  nickname!: string;
}

export class LoginDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  password!: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty({ message: 'refreshToken 不能为空' })
  refreshToken!: string;
}
