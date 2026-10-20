import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { ExamsService } from './exams.service';

function facultyUser() {
  return { id: 'faculty-1' };
}

describe('ExamsService faculty and student workflows', () => {
  it('creates a draft with ordered MCQ choices and correct-answer data', async () => {
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(facultyUser()) },
      exam: { create: jest.fn().mockResolvedValue({ id: 'exam-1' }) },
    };
    const service = new ExamsService(prisma as unknown as PrismaService);
    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(start.getTime() + 3_600_000);

    await service.createFacultyExam('faculty-1', {
      title: 'Networks',
      subject: 'Computing',
      instructions: 'Answer all questions.',
      durationMinutes: 30,
      opensAt: start.toISOString(),
      closesAt: end.toISOString(),
      maxMarks: 2,
      passMarks: 1,
      questions: [
        {
          prompt: 'Which protocol is connection-oriented?',
          type: 'SINGLE_CHOICE',
          marks: 2,
          options: [
            { text: 'TCP', isCorrect: true },
            { text: 'UDP', isCorrect: false },
          ],
        },
      ],
    });

    expect(prisma.exam.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdById: 'faculty-1',
          status: 'DRAFT',
          questions: {
            create: [
              expect.objectContaining({
                position: 1,
                options: {
                  create: [
                    expect.objectContaining({
                      position: 1,
                      isCorrect: true,
                    }),
                    expect.objectContaining({
                      position: 2,
                      isCorrect: false,
                    }),
                  ],
                },
              }),
            ],
          },
        }),
      }),
    );
  });

  it('rejects publishing when question marks do not equal the exam total', async () => {
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(facultyUser()) },
      exam: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'exam-1',
          createdById: 'faculty-1',
          status: 'DRAFT',
          maxMarks: 10,
          passMarks: 5,
          opensAt: new Date(Date.now() + 86_400_000),
          closesAt: new Date(Date.now() + 172_800_000),
          _count: { attempts: 0 },
        }),
      },
      question: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'q1', marks: 9, type: 'SINGLE_CHOICE', options: [] },
        ]),
      },
    };
    const service = new ExamsService(prisma as unknown as PrismaService);

    await expect(
      service.publishFacultyExam('faculty-1', 'exam-1'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.exam.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'exam-1', createdById: 'faculty-1' },
      }),
    );
  });

  it('does not allow faculty to access an examination they do not own', async () => {
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(facultyUser()) },
      exam: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new ExamsService(prisma as unknown as PrismaService);

    await expect(
      service.deleteFacultyExam('faculty-1', 'other-exam'),
    ).rejects.toThrow(NotFoundException);
  });

  it('evaluates each descriptive response and calculates the final score', async () => {
    const attempt = {
      id: 'attempt-1',
      status: 'SUBMITTED',
      exam: {
        createdById: 'faculty-1',
        maxMarks: 10,
        passMarks: 6,
        questions: [
          { id: 'mcq-1', type: 'SINGLE_CHOICE', marks: 4 },
          { id: 'essay-1', type: 'DESCRIPTIVE', marks: 6 },
        ],
      },
      result: {
        id: 'result-1',
        status: 'PENDING_EVALUATION',
        objectiveMarks: 4,
      },
    };
    const tx = {
      studentAnswer: { upsert: jest.fn().mockResolvedValue({}) },
      result: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'result-1',
          objectiveMarks: 4,
          descriptiveMarks: 5,
          totalMarks: 9,
          passed: true,
          status: 'EVALUATED',
        }),
      },
      examAttempt: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(facultyUser()) },
      examAttempt: { findFirst: jest.fn().mockResolvedValue(attempt) },
      $transaction: jest.fn((work: (transaction: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const service = new ExamsService(prisma as unknown as PrismaService);

    const result = await service.evaluateAttempt('faculty-1', 'attempt-1', [
      { questionId: 'essay-1', awardedMarks: 5, feedback: 'Good explanation.' },
    ]);

    expect(tx.studentAnswer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          questionId: 'essay-1',
          awardedMarks: 5,
          feedback: 'Good explanation.',
        }),
      }),
    );
    expect(tx.result.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          descriptiveMarks: 5,
          totalMarks: 9,
          passed: true,
          status: 'EVALUATED',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ totalMarks: 9, status: 'EVALUATED' }),
    );
  });

  it('does not award marks to an empty MCQ when no correct option is recorded', async () => {
    const attempt = {
      id: 'attempt-1',
      status: 'IN_PROGRESS',
      deadlineAt: new Date(Date.now() + 60_000),
      answers: [],
      exam: {
        passMarks: 1,
        maxMarks: 1,
        negativeMarking: false,
        negativeMarkValue: 0,
        questions: [
          {
            id: 'q1',
            type: 'SINGLE_CHOICE',
            marks: 1,
            negativeMarks: 0,
            options: [],
          },
        ],
      },
      result: null,
    };
    const tx = {
      examAttempt: {
        findUnique: jest.fn().mockResolvedValue(attempt),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      studentAnswer: { upsert: jest.fn().mockResolvedValue({}) },
      result: {
        upsert: jest.fn().mockResolvedValue({
          id: 'result-1',
          objectiveMarks: 0,
          totalMarks: 0,
          status: 'EVALUATED',
        }),
      },
      examActivityLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((work: (transaction: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const service = new ExamsService(prisma as unknown as PrismaService);

    const result = await service.finalize('attempt-1', 'MANUAL');

    expect(tx.studentAnswer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ awardedMarks: 0 }),
      }),
    );
    expect(tx.result.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          objectiveMarks: 0,
          totalMarks: 0,
          passed: false,
        }),
      }),
    );
    expect(result.status).toBe('EVALUATED');
  });

  it('blocks a student from reopening an already submitted attempt', async () => {
    const prisma = {
      examAttempt: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'attempt-1',
          studentId: 'student-1',
          status: 'SUBMITTED',
          exam: { createdById: 'faculty-1' },
        }),
      },
    };
    const service = new ExamsService(prisma as unknown as PrismaService);

    await expect(
      service.getAttempt('attempt-1', { id: 'student-1', role: 'STUDENT' }),
    ).rejects.toThrow('Re-entry is not allowed.');
  });

  it('clears a previously saved descriptive response when autosaved empty', async () => {
    const tx = {
      examAttempt: {
        findUnique: jest.fn().mockResolvedValue({
          studentId: 'student-1',
          examId: 'exam-1',
          status: 'IN_PROGRESS',
          deadlineAt: new Date(Date.now() + 60_000),
        }),
      },
      question: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'essay-1',
          type: 'DESCRIPTIVE',
          options: [],
        }),
      },
      studentAnswer: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      examAttempt: {
        findUnique: jest.fn().mockResolvedValue({
          studentId: 'student-1',
          status: 'IN_PROGRESS',
          deadlineAt: new Date(Date.now() + 60_000),
        }),
      },
      $transaction: jest.fn((work: (transaction: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const service = new ExamsService(prisma as unknown as PrismaService);

    await service.saveAnswer('attempt-1', 'essay-1', 'student-1', {
      selectedIds: [],
      textAnswer: '',
    });

    expect(tx.studentAnswer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ textAnswer: '' }),
        update: expect.objectContaining({ textAnswer: '' }),
      }),
    );
  });

  it('returns a conflict when concurrent starts race on the unique attempt constraint', async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: 'test' },
    );
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(prismaError),
    };
    const service = new ExamsService(prisma as unknown as PrismaService);

    await expect(
      service.start('exam-1', 'student-1', true),
    ).rejects.toThrow(ConflictException);
  });
});
