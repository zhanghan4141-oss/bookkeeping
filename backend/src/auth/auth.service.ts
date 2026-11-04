import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto, RegisterDto } from './dto/auth.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (exists) throw new ConflictException('该邮箱已注册');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        nickname: dto.nickname,
        reminderSetting: {
          create: { email: dto.email },
        },
      },
    });

    return {
      user: this.safeUser(user),
      ...this.signTokens(user),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new UnauthorizedException('邮箱或密码错误');

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('邮箱或密码错误');

    return {
      user: this.safeUser(user),
      ...this.signTokens(user),
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user) throw new UnauthorizedException('用户不存在');

      return {
        user: this.safeUser(user),
        ...this.signTokens(user),
      };
    } catch {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('用户不存在');
    return this.safeUser(user);
  }

  private signTokens(user: {
    id: string;
    email: string;
    nickname: string;
  }) {
    const payload = {
      sub: user.id,
      email: user.email,
      nickname: user.nickname,
    };
    return {
      accessToken: this.jwtService.sign(payload, {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ??
          '15m') as unknown as number,
      }),
      refreshToken: this.jwtService.sign(payload, {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ??
          '30d') as unknown as number,
      }),
    };
  }

  private safeUser(user: {
    id: string;
    email: string;
    nickname: string;
    avatarUrl: string | null;
    createdAt: Date;
  }) {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    };
  }
}
