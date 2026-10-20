import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtGuard } from './jwt.guard';
@Module({ imports: [JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET || 'development-only-change-this-secret-32-chars', signOptions: { expiresIn: process.env.JWT_ACCESS_TTL || '15m' } })], controllers: [AuthController], providers: [AuthService, PrismaService, JwtGuard], exports: [JwtGuard, AuthService] })
export class AuthModule {}
