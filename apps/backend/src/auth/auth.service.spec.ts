import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService admin account management', () => {
  const reviewedFaculty = {
    id: 'faculty-1',
    email: 'faculty@example.com',
    name: 'Faculty User',
    role: 'FACULTY',
    status: 'ACTIVE',
    facultyProfile: { verificationStatus: 'APPROVED' },
  };

  function createService(user: Record<string, unknown> | null) {
    const transaction = {
      user: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(reviewedFaculty),
      },
      facultyProfile: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
      },
      $transaction: jest.fn((work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      {} as never,
    );
    return { service, prisma, transaction };
  }

  it('approves pending faculty and updates verification and account status atomically', async () => {
    const { service, transaction } = createService({
      id: 'faculty-1',
      role: 'FACULTY',
      status: 'PENDING',
      facultyProfile: { verificationStatus: 'PENDING' },
    });

    await service.approveRegistration('faculty-1', 'admin-1');

    expect(transaction.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'faculty-1', role: 'FACULTY', status: 'PENDING' },
      data: { status: 'ACTIVE' },
    });
    expect(transaction.facultyProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'faculty-1' },
      data: { verificationStatus: 'APPROVED' },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'admin-1',
          action: 'USER_REGISTRATION_APPROVED',
        }),
      }),
    );
  });

  it('rejects pending registrations and marks faculty verification rejected', async () => {
    const { service, transaction } = createService({
      id: 'faculty-1',
      role: 'FACULTY',
      status: 'PENDING',
      facultyProfile: { verificationStatus: 'PENDING' },
    });

    await service.rejectRegistration('faculty-1', 'admin-1');

    expect(transaction.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'faculty-1', role: 'FACULTY', status: 'PENDING' },
      data: { status: 'REJECTED' },
    });
    expect(transaction.facultyProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'faculty-1' },
      data: { verificationStatus: 'REJECTED' },
    });
  });

  it('does not reactivate faculty whose verification is not approved', async () => {
    const { service, prisma } = createService({
      id: 'faculty-1',
      role: 'FACULTY',
      status: 'DISABLED',
      facultyProfile: { verificationStatus: 'PENDING' },
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      status: 'DISABLED',
    });

    await expect(service.activateUser('faculty-1', 'admin-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('does not allow administrator accounts to be deactivated', async () => {
    const { service } = createService({
      id: 'admin-1',
      role: 'ADMIN',
      status: 'ACTIVE',
      facultyProfile: null,
    });

    await expect(service.deactivateUser('admin-1', 'admin-1')).rejects.toThrow(
      ConflictException,
    );
  });
});
