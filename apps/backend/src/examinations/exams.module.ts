import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';
@Module({ imports: [JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET || 'development-only-change-this-secret-32-chars' })], controllers: [ExamsController], providers: [ExamsService, PrismaService, JwtGuard] })
export class ExamsModule {}
