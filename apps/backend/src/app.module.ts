import { Module } from '@nestjs/common';
import { PrismaService } from './common/prisma.service';
import { HealthController } from './common/health.controller';
import { AuthModule } from './auth/auth.module';
import { ExamsModule } from './examinations/exams.module';
@Module({ imports: [AuthModule, ExamsModule], controllers: [HealthController], providers: [PrismaService] })
export class AppModule {}
