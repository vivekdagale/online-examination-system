
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../common/prisma.service';
import { AdminUsersQueryDto, LoginDto, RegisterDto } from './dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      throw new BadRequestException(
        'An account with this email already exists.',
      );
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        passwordHash,
        role: dto.role,
        status: 'PENDING',
        ...(dto.role === 'STUDENT'
          ? { studentProfile: { create: {} } }
          : { facultyProfile: { create: {} } }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
      },
    });

    return {
      message:
        'Registration received. An administrator must activate this account.',
      user,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    if (
      !user ||
      !(await argon2.verify(user.passwordHash, dto.password))
    ) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException(
        'This account is not active. Contact an administrator.',
      );
    }

    if (user.role === 'FACULTY') {
      const profile = await this.prisma.facultyProfile.findUnique({
        where: { userId: user.id },
      });

      if (profile?.verificationStatus !== 'APPROVED') {
        throw new ForbiddenException(
          'Faculty verification is still pending.',
        );
      }
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      email: user.email,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async getAdminStats() {
    const [
      totalUsers,
      students,
      faculty,
      pendingRegistrations,
      activeAccounts,
      disabledAccounts,
      rejectedRegistrations,
      pendingFacultyVerification,
      totalExams,
      publishedExams,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: 'STUDENT' } }),
      this.prisma.user.count({ where: { role: 'FACULTY' } }),
      this.prisma.user.count({ where: { status: 'PENDING' } }),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { status: 'DISABLED' } }),
      this.prisma.user.count({ where: { status: 'REJECTED' } }),
      this.prisma.facultyProfile.count({
        where: { verificationStatus: 'PENDING' },
      }),
      this.prisma.exam.count(),
      this.prisma.exam.count({ where: { status: 'PUBLISHED' } }),
    ]);

    return {
      totalUsers,
      students,
      faculty,
      pendingRegistrations,
      activeAccounts,
      disabledAccounts,
      rejectedRegistrations,
      pendingFacultyVerification,
      totalExams,
      publishedExams,
    };
  }

  async listUsers(query: AdminUsersQueryDto = {}) {
    const search = query.search?.trim();
    return this.prisma.user.findMany({
      where: {
        ...(query.role ? { role: query.role } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
        facultyProfile: {
          select: {
            department: true,
            employeeCode: true,
            verificationStatus: true,
            verificationNote: true,
          },
        },
        studentProfile: {
          select: { department: true, studentCode: true, year: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { email: 'asc' }],
    });
  }

  async listPendingUsers() {
    return this.listUsers({ status: 'PENDING' });
  }

  async approveRegistration(userId: string, actorId: string) {
    return this.decideRegistration(userId, actorId, true);
  }

  async rejectRegistration(userId: string, actorId: string) {
    return this.decideRegistration(userId, actorId, false);
  }

  private async decideRegistration(
    userId: string,
    actorId: string,
    approve: boolean,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        status: true,
        facultyProfile: { select: { verificationStatus: true } },
      },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    if (user.role === 'ADMIN' || user.status !== 'PENDING') {
      throw new ConflictException(
        'Only pending student or faculty registrations can be reviewed.',
      );
    }
    if (user.role === 'FACULTY' && !user.facultyProfile) {
      throw new ConflictException(
        'Faculty profile is missing; registration cannot be reviewed.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const status = approve ? 'ACTIVE' : 'REJECTED';
      const update = await tx.user.updateMany({
        where: { id: userId, role: user.role, status: 'PENDING' },
        data: { status },
      });
      if (update.count !== 1) {
        throw new ConflictException(
          'This registration has already been reviewed.',
        );
      }
      if (user.role === 'FACULTY') {
        const profileUpdate = await tx.facultyProfile.updateMany({
          where: { userId },
          data: { verificationStatus: approve ? 'APPROVED' : 'REJECTED' },
        });
        if (profileUpdate.count !== 1) {
          throw new ConflictException(
            'Faculty profile is missing; registration cannot be reviewed.',
          );
        }
      }

      await tx.auditLog.create({
        data: {
          actorId,
          action: approve
            ? 'USER_REGISTRATION_APPROVED'
            : 'USER_REGISTRATION_REJECTED',
          entityType: 'User',
          entityId: userId,
          detail: {
            role: user.role,
            previousStatus: 'PENDING',
            status,
            facultyVerification:
              user.role === 'FACULTY'
                ? approve
                  ? 'APPROVED'
                  : 'REJECTED'
                : null,
          },
        },
      });

      const reviewedUser = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          facultyProfile: { select: { verificationStatus: true } },
        },
      });
      return {
        message: approve
          ? 'Registration approved successfully.'
          : 'Registration rejected successfully.',
        user: reviewedUser,
      };
    });
  }

  async activateUser(userId: string, actorId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    if (user.status === 'PENDING') {
      return this.approveRegistration(userId, actorId);
    }
    return this.changeAccountStatus(userId, actorId, 'DISABLED', 'ACTIVE');
  }

  async deactivateUser(userId: string, actorId: string) {
    return this.changeAccountStatus(userId, actorId, 'ACTIVE', 'DISABLED');
  }

  private async changeAccountStatus(
    userId: string,
    actorId: string,
    expectedStatus: 'ACTIVE' | 'DISABLED',
    nextStatus: 'ACTIVE' | 'DISABLED',
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        status: true,
        facultyProfile: { select: { verificationStatus: true } },
      },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    if (user.role === 'ADMIN') {
      throw new ConflictException(
        'Administrator accounts cannot be activated or deactivated here.',
      );
    }
    if (user.status !== expectedStatus) {
      throw new ConflictException(
        `Only ${expectedStatus.toLowerCase()} accounts can be ${
          nextStatus === 'ACTIVE' ? 'activated' : 'deactivated'
        }.`,
      );
    }
    if (
      nextStatus === 'ACTIVE' &&
      user.role === 'FACULTY' &&
      user.facultyProfile?.verificationStatus !== 'APPROVED'
    ) {
      throw new ConflictException(
        'Faculty verification must be approved before activating this account.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const update = await tx.user.updateMany({
        where: { id: userId, role: user.role, status: expectedStatus },
        data: { status: nextStatus },
      });
      if (update.count !== 1) {
        throw new ConflictException('This account status has already changed.');
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action:
            nextStatus === 'ACTIVE' ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
          entityType: 'User',
          entityId: userId,
          detail: {
            role: user.role,
            previousStatus: expectedStatus,
            status: nextStatus,
          },
        },
      });
      const updatedUser = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          facultyProfile: { select: { verificationStatus: true } },
        },
      });
      return {
        message: `Account ${
          nextStatus === 'ACTIVE' ? 'activated' : 'deactivated'
        } successfully.`,
        user: updatedUser,
      };
    });
  }
}
