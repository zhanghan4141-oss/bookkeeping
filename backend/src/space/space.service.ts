import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSpaceDto, UpdateSpaceDto } from './dto/space.dto.js';

@Injectable()
export class SpaceService {
  constructor(private readonly prisma: PrismaService) {}

  /** 我的空间列表（含每个空间的账本数） */
  async findAll(userId: string) {
    const spaces = await this.prisma.userSpace.findMany({
      where: { userId },
      include: { _count: { select: { ledgerSpaces: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return spaces.map((s) => ({
      id: s.id,
      name: s.name,
      icon: s.icon,
      color: s.color,
      createdAt: s.createdAt,
      ledgerCount: s._count.ledgerSpaces,
    }));
  }

  async create(userId: string, dto: CreateSpaceDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('空间名称不能为空');
    try {
      return await this.prisma.userSpace.create({
        data: { userId, name, icon: dto.icon, color: dto.color },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('空间名称已存在');
      }
      throw e;
    }
  }

  async update(userId: string, id: string, dto: UpdateSpaceDto) {
    const sp = await this.prisma.userSpace.findFirst({ where: { userId, id } });
    if (!sp) throw new NotFoundException('空间不存在');
    const data: Prisma.UserSpaceUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (dto.color !== undefined) data.color = dto.color;
    try {
      return await this.prisma.userSpace.update({ where: { id }, data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('空间名称已存在');
      }
      throw e;
    }
  }

  /** 删除空间：账本的归类记录由 FK 级联删除（账本自动回默认分组） */
  async remove(userId: string, id: string) {
    const sp = await this.prisma.userSpace.findFirst({ where: { userId, id } });
    if (!sp) throw new NotFoundException('空间不存在');
    await this.prisma.userSpace.delete({ where: { id } });
    return { success: true };
  }
}