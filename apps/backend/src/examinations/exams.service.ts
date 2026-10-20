
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { EvaluateAnswerDto, ExamQuestionDto, SaveExamDto } from './dto';

@Injectable()
export class ExamsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExamsService.name);
  private expiryTimer: ReturnType<typeof setInterval> | undefined;
  private expirySweepRunning = false;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.expiryTimer = setInterval(() => {
      void this.finalizeExpiredAttempts();
    }, 5_000);
  }

  onModuleDestroy() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
  }

  private async finalizeExpiredAttempts(studentId?: string) {
    if (this.expirySweepRunning && !studentId) return;
    if (!studentId) this.expirySweepRunning = true;
    try {
      const overdue = await this.prisma.examAttempt.findMany({
        where: {
          status: 'IN_PROGRESS',
          deadlineAt: { lte: new Date() },
          ...(studentId ? { studentId } : {}),
        },
        select: { id: true },
        take: 100,
      });
      for (const attempt of overdue) {
        try {
          await this.finalize(attempt.id, 'TIMEOUT');
        } catch (error) {
          if (!(error instanceof ConflictException)) {
            this.logger.error(
              `Could not auto-submit overdue attempt ${attempt.id}.`,
              error instanceof Error ? error.stack : String(error),
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(
        'Could not scan for overdue attempts.',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      if (!studentId) this.expirySweepRunning = false;
    }
  }

  private async assertApprovedFaculty(facultyId: string) {
    const faculty = await this.prisma.user.findFirst({
      where: {
        id: facultyId,
        role: 'FACULTY',
        status: 'ACTIVE',
        facultyProfile: { is: { verificationStatus: 'APPROVED' } },
      },
      select: { id: true },
    });
    if (!faculty) {
      throw new ForbiddenException(
        'An active, verified faculty account is required.',
      );
    }
  }

  private async getOwnedExam(facultyId: string, examId: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, createdById: facultyId },
      include: { _count: { select: { attempts: true } } },
    });
    if (!exam) {
      throw new NotFoundException('Examination not found.');
    }
    return exam;
  }

  private validateExamInput(dto: SaveExamDto) {
    if (!dto.title.trim() || !dto.subject.trim()) {
      throw new BadRequestException(
        'Examination title and subject are required.',
      );
    }
    const opensAt = new Date(dto.opensAt);
    const closesAt = new Date(dto.closesAt);
    if (
      !Number.isFinite(opensAt.getTime()) ||
      !Number.isFinite(closesAt.getTime()) ||
      closesAt <= opensAt
    ) {
      throw new BadRequestException(
        'The examination end date must be later than its start date.',
      );
    }
    if (dto.passMarks > dto.maxMarks) {
      throw new BadRequestException(
        'Passing marks cannot exceed the examination total.',
      );
    }
    for (const [index, question] of dto.questions.entries()) {
      if (!question.prompt.trim()) {
        throw new BadRequestException(
          `Question ${index + 1} must include a prompt.`,
        );
      }
      if (question.negativeMarks !== undefined && question.negativeMarks > question.marks) {
        throw new BadRequestException(
          `Question ${index + 1} negative marks cannot exceed its marks.`,
        );
      }
      if (question.type === 'DESCRIPTIVE') {
        if (question.options.length) {
          throw new BadRequestException(
            `Descriptive question ${index + 1} cannot have options.`,
          );
        }
      } else {
        if (question.options.length < 2) {
          throw new BadRequestException(
            `Question ${index + 1} needs at least two options.`,
          );
        }
        if (question.options.some((option) => !option.text.trim())) {
          throw new BadRequestException(
            `Every option for question ${index + 1} needs text.`,
          );
        }
        const correctOptions = question.options.filter(
          (option) => option.isCorrect,
        ).length;
        if (
          (question.type === 'SINGLE_CHOICE' && correctOptions !== 1) ||
          (question.type === 'MULTIPLE_SELECT' && correctOptions < 1)
        ) {
          throw new BadRequestException(
            `Set the correct answer for question ${index + 1}.`,
          );
        }
      }
    }
  }

  private questionCreateData(question: ExamQuestionDto, position: number) {
    return {
      prompt: question.prompt.trim(),
      type: question.type,
      marks: question.marks,
      negativeMarks: question.negativeMarks ?? 0,
      position: position + 1,
      options: {
        create: question.options.map((option, optionIndex) => ({
          text: option.text.trim(),
          isCorrect: option.isCorrect,
          position: optionIndex + 1,
        })),
      },
    };
  }

  async facultyDashboard(facultyId: string) {
    await this.assertApprovedFaculty(facultyId);
    const now = new Date();
    const examScope = { createdById: facultyId };
    const attemptScope = { exam: { createdById: facultyId } };
    const [
      totalExams,
      draftExams,
      publishedExams,
      upcomingExams,
      studentAttempts,
      submissionsAwaitingEvaluation,
      exams,
    ] = await Promise.all([
      this.prisma.exam.count({ where: examScope }),
      this.prisma.exam.count({ where: { ...examScope, status: 'DRAFT' } }),
      this.prisma.exam.count({ where: { ...examScope, status: 'PUBLISHED' } }),
      this.prisma.exam.count({
        where: { ...examScope, status: 'PUBLISHED', opensAt: { gt: now } },
      }),
      this.prisma.examAttempt.count({ where: attemptScope }),
      this.prisma.result.count({
        where: {
          status: 'PENDING_EVALUATION',
          attempt: { exam: { createdById: facultyId } },
        },
      }),
      this.prisma.exam.findMany({
        where: examScope,
        include: {
          _count: { select: { questions: true, attempts: true } },
          questions: {
            orderBy: { position: 'asc' },
            include: { options: { orderBy: { position: 'asc' } } },
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);
    return {
      stats: {
        totalExams,
        draftExams,
        publishedExams,
        upcomingExams,
        studentAttempts,
        submissionsAwaitingEvaluation,
      },
      exams,
    };
  }

  async listFacultyExams(facultyId: string) {
    await this.assertApprovedFaculty(facultyId);
    return this.prisma.exam.findMany({
      where: { createdById: facultyId },
      include: {
        _count: { select: { attempts: true } },
        questions: {
          orderBy: { position: 'asc' },
          include: { options: { orderBy: { position: 'asc' } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async studentDashboard(studentId: string) {
    await this.finalizeExpiredAttempts(studentId);
    const now = new Date();
    const exams = await this.prisma.exam.findMany({
      where: {
        OR: [
          {
            status: 'PUBLISHED',
            OR: [
              { eligibility: { none: {} } },
              { eligibility: { some: { studentId } } },
            ],
          },
          {
            status: 'ARCHIVED',
            attempts: { some: { studentId } },
          },
        ],
      },
      include: {
        _count: { select: { questions: true } },
        attempts: {
          where: { studentId },
          select: {
            id: true,
            status: true,
            startedAt: true,
            submittedAt: true,
            deadlineAt: true,
            submissionReason: true,
            result: {
              select: {
                id: true,
                objectiveMarks: true,
                descriptiveMarks: true,
                totalMarks: true,
                passed: true,
                status: true,
                publishedAt: true,
              },
            },
          },
        },
      },
      orderBy: { opensAt: 'asc' },
    });

    const classified = exams.map((exam) => {
      const attempt = exam.attempts[0] ?? null;
      let state: string;
      if (attempt?.status === 'IN_PROGRESS') {
        state = 'ONGOING';
      } else if (
        attempt?.status === 'SUBMITTED' ||
        attempt?.status === 'EVALUATED'
      ) {
        state = 'COMPLETED';
      } else if (exam.status === 'ARCHIVED' || now > exam.closesAt) {
        state = 'CLOSED';
      } else if (now < exam.opensAt) {
        state = 'UPCOMING';
      } else {
        state = 'AVAILABLE';
      }
      return {
        id: exam.id,
        title: exam.title,
        subject: exam.subject,
        instructions: exam.instructions,
        status: exam.status,
        state,
        durationMinutes: exam.durationMinutes,
        opensAt: exam.opensAt,
        closesAt: exam.closesAt,
        maxMarks: exam.maxMarks,
        passMarks: exam.passMarks,
        questionCount: exam._count.questions,
        attempt: attempt
          ? {
              id: attempt.id,
              status: attempt.status,
              startedAt: attempt.startedAt,
              submittedAt: attempt.submittedAt,
              deadlineAt: attempt.status === 'IN_PROGRESS' ? attempt.deadlineAt : null,
              submissionReason: attempt.submissionReason,
              result:
                attempt.result?.status === 'PUBLISHED'
                  ? attempt.result
                  : null,
            }
          : null,
      };
    });
    const results = await this.studentResults(studentId);
    return {
      stats: {
        availableExams: classified.filter((exam) => exam.state === 'AVAILABLE').length,
        upcomingExams: classified.filter((exam) => exam.state === 'UPCOMING').length,
        ongoingAttempts: classified.filter((exam) => exam.state === 'ONGOING').length,
        completedExams: classified.filter((exam) => exam.state === 'COMPLETED').length,
        publishedResults: results.length,
      },
      exams: classified,
      results,
    };
  }

  async createFacultyExam(facultyId: string, dto: SaveExamDto) {
    await this.assertApprovedFaculty(facultyId);
    this.validateExamInput(dto);
    return this.prisma.exam.create({
      data: {
        title: dto.title.trim(),
        subject: dto.subject.trim(),
        instructions: dto.instructions.trim(),
        durationMinutes: dto.durationMinutes,
        opensAt: new Date(dto.opensAt),
        closesAt: new Date(dto.closesAt),
        maxMarks: dto.maxMarks,
        passMarks: dto.passMarks,
        negativeMarking: dto.negativeMarking ?? false,
        negativeMarkValue: dto.negativeMarkValue ?? 0,
        createdById: facultyId,
        status: 'DRAFT',
        questions: {
          create: dto.questions.map((question, index) =>
            this.questionCreateData(question, index),
          ),
        },
      },
      include: {
        questions: {
          orderBy: { position: 'asc' },
          include: { options: { orderBy: { position: 'asc' } } },
        },
      },
    });
  }

  async updateFacultyExam(
    facultyId: string,
    examId: string,
    dto: SaveExamDto,
  ) {
    await this.assertApprovedFaculty(facultyId);
    this.validateExamInput(dto);
    const exam = await this.getOwnedExam(facultyId, examId);
    const editable =
      exam.status === 'DRAFT' ||
      (exam.status === 'PUBLISHED' &&
        exam.opensAt > new Date() &&
        exam._count.attempts === 0);
    if (!editable || exam._count.attempts > 0) {
      throw new ConflictException(
        'Only drafts or not-yet-open exams without attempts can be edited.',
      );
    }
    if (
      exam.status === 'PUBLISHED' &&
      (new Date(dto.opensAt) <= new Date() ||
        new Date(dto.closesAt) <= new Date())
    ) {
      throw new BadRequestException(
        'A published examination can only be edited while its schedule is still in the future.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.question.deleteMany({ where: { examId } });
      return tx.exam.update({
        where: { id: examId },
        data: {
          title: dto.title.trim(),
          subject: dto.subject.trim(),
          instructions: dto.instructions.trim(),
          durationMinutes: dto.durationMinutes,
          opensAt: new Date(dto.opensAt),
          closesAt: new Date(dto.closesAt),
          maxMarks: dto.maxMarks,
          passMarks: dto.passMarks,
          negativeMarking: dto.negativeMarking ?? false,
          negativeMarkValue: dto.negativeMarkValue ?? 0,
          questions: {
            create: dto.questions.map((question, index) =>
              this.questionCreateData(question, index),
            ),
          },
        },
        include: {
          questions: {
            orderBy: { position: 'asc' },
            include: { options: { orderBy: { position: 'asc' } } },
          },
        },
      });
    });
  }

  async deleteFacultyExam(facultyId: string, examId: string) {
    await this.assertApprovedFaculty(facultyId);
    const exam = await this.getOwnedExam(facultyId, examId);
    if (exam.status !== 'DRAFT' || exam._count.attempts > 0) {
      throw new ConflictException(
        'Only draft examinations without student attempts can be deleted.',
      );
    }
    await this.prisma.exam.delete({ where: { id: examId } });
    return { message: 'Draft examination deleted.' };
  }

  async publishFacultyExam(facultyId: string, examId: string) {
    await this.assertApprovedFaculty(facultyId);
    const exam = await this.getOwnedExam(facultyId, examId);
    if (exam.status !== 'DRAFT') {
      throw new ConflictException('Only draft examinations can be published.');
    }
    const questions = await this.prisma.question.findMany({
      where: { examId },
      include: { options: true },
      orderBy: { position: 'asc' },
    });
    if (!questions.length) {
      throw new BadRequestException(
        'Add at least one question before publishing.',
      );
    }
    const totalMarks = questions.reduce((sum, question) => sum + question.marks, 0);
    if (Math.round(totalMarks * 100) !== Math.round(exam.maxMarks * 100)) {
      throw new BadRequestException(
        'The sum of question marks must equal the examination total.',
      );
    }
    if (exam.passMarks > exam.maxMarks) {
      throw new BadRequestException(
        'Passing marks cannot exceed the examination total.',
      );
    }
    if (exam.opensAt <= new Date() || exam.closesAt <= exam.opensAt) {
      throw new BadRequestException(
        'Published examinations must have a future start and a later end date.',
      );
    }
    const update = await this.prisma.exam.updateMany({
      where: { id: examId, createdById: facultyId, status: 'DRAFT' },
      data: { status: 'PUBLISHED' },
    });
    if (update.count !== 1) {
      throw new ConflictException('The examination changed before publishing.');
    }
    return this.prisma.exam.findUniqueOrThrow({
      where: { id: examId },
      include: { _count: { select: { attempts: true, questions: true } } },
    });
  }

  async closeFacultyExam(facultyId: string, examId: string) {
    await this.assertApprovedFaculty(facultyId);
    await this.getOwnedExam(facultyId, examId);
    const update = await this.prisma.exam.updateMany({
      where: { id: examId, createdById: facultyId, status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    });
    if (update.count !== 1) {
      throw new ConflictException('Only published examinations can be closed.');
    }
    return this.prisma.exam.findUniqueOrThrow({ where: { id: examId } });
  }

  async listFacultyAttempts(facultyId: string, examId?: string) {
    await this.assertApprovedFaculty(facultyId);
    if (examId) {
      await this.getOwnedExam(facultyId, examId);
    }
    const attempts = await this.prisma.examAttempt.findMany({
      where: {
        exam: { createdById: facultyId, ...(examId ? { id: examId } : {}) },
      },
      include: {
        student: { select: { id: true, name: true, email: true } },
        exam: {
          select: {
            id: true,
            title: true,
            subject: true,
            maxMarks: true,
            passMarks: true,
            questions: {
              orderBy: { position: 'asc' },
              include: { options: { orderBy: { position: 'asc' } } },
            },
          },
        },
        answers: {
          include: {
            question: {
              include: { options: { orderBy: { position: 'asc' } } },
            },
          },
        },
        result: true,
      },
      orderBy: [{ submittedAt: 'desc' }, { startedAt: 'desc' }],
    });
    return attempts.map((attempt) => {
      const answers = new Map(
        attempt.answers.map((answer) => [answer.questionId, answer]),
      );
      return {
        ...attempt,
        answers: attempt.exam.questions.map(
          (question) =>
            answers.get(question.id) ?? {
              id: `missing-${attempt.id}-${question.id}`,
              attemptId: attempt.id,
              questionId: question.id,
              selectedIds: [],
              textAnswer: null,
              isFlagged: false,
              version: 0,
              savedAt: attempt.submittedAt ?? attempt.startedAt,
              awardedMarks: question.type === 'DESCRIPTIVE' ? null : 0,
              feedback: null,
              question,
            },
        ),
      };
    });
  }

  async evaluateAttempt(
    facultyId: string,
    attemptId: string,
    grades: EvaluateAnswerDto[],
  ) {
    await this.assertApprovedFaculty(facultyId);
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, exam: { createdById: facultyId } },
      include: {
        exam: { include: { questions: true } },
        result: true,
      },
    });
    if (!attempt) {
      throw new NotFoundException('Submission not found.');
    }
    if (attempt.status !== 'SUBMITTED' || !attempt.result) {
      throw new ConflictException(
        'Only submitted attempts awaiting evaluation can be graded.',
      );
    }
    const descriptive = attempt.exam.questions.filter(
      (question) => question.type === 'DESCRIPTIVE',
    );
    if (!descriptive.length) {
      throw new ConflictException(
        'This submission has no descriptive questions to evaluate.',
      );
    }
    const byId = new Map(descriptive.map((question) => [question.id, question]));
    if (
      grades.length !== descriptive.length ||
      new Set(grades.map((grade) => grade.questionId)).size !== grades.length
    ) {
      throw new BadRequestException(
        'Provide a grade for each descriptive question exactly once.',
      );
    }
    for (const grade of grades) {
      const question = byId.get(grade.questionId);
      if (!question) {
        throw new BadRequestException(
          'Only descriptive questions from this examination can be graded.',
        );
      }
      if (grade.awardedMarks > question.marks) {
        throw new BadRequestException(
          `Awarded marks cannot exceed ${question.marks} for a question.`,
        );
      }
    }
    const descriptiveMarks =
      Math.round(grades.reduce((sum, grade) => sum + grade.awardedMarks, 0) * 100) /
      100;
    const totalMarks =
      Math.round((attempt.result.objectiveMarks + descriptiveMarks) * 100) / 100;
    if (totalMarks > attempt.exam.maxMarks) {
      throw new BadRequestException(
        'The evaluated total exceeds the examination maximum.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      for (const grade of grades) {
        await tx.studentAnswer.upsert({
          where: {
            attemptId_questionId: {
              attemptId,
              questionId: grade.questionId,
            },
          },
          create: {
            attemptId,
            questionId: grade.questionId,
            selectedIds: [],
            awardedMarks: grade.awardedMarks,
            feedback: grade.feedback?.trim() || null,
          },
          update: {
            awardedMarks: grade.awardedMarks,
            feedback: grade.feedback?.trim() || null,
          },
        });
      }
      const resultUpdate = await tx.result.updateMany({
        where: { id: attempt.result!.id, status: 'PENDING_EVALUATION' },
        data: {
          descriptiveMarks,
          totalMarks,
          passed: totalMarks >= attempt.exam.passMarks,
          status: 'EVALUATED',
        },
      });
      if (resultUpdate.count !== 1) {
        throw new ConflictException(
          'This submission has already been evaluated.',
        );
      }
      await tx.examAttempt.updateMany({
        where: { id: attemptId, status: 'SUBMITTED' },
        data: { status: 'EVALUATED' },
      });
      return tx.result.findUniqueOrThrow({
        where: { id: attempt.result!.id },
        include: {
          attempt: {
            include: {
              student: { select: { id: true, name: true, email: true } },
              exam: { select: { id: true, title: true, maxMarks: true, passMarks: true } },
            },
          },
        },
      });
    });
  }

  async listEligible(studentId: string) {
    await this.finalizeExpiredAttempts(studentId);
    const now = new Date();

    const exams = await this.prisma.exam.findMany({
      where: {
        status: 'PUBLISHED',
        OR: [
          { eligibility: { none: {} } },
          { eligibility: { some: { studentId } } },
        ],
      },
      include: {
        _count: { select: { questions: true } },
        attempts: {
          where: { studentId },
          select: { id: true, status: true, deadlineAt: true },
        },
      },
      orderBy: { opensAt: 'asc' },
    });

    return exams.map((e) => {
      const attempt = e.attempts[0];

      let state =
        now < e.opensAt
          ? 'UPCOMING'
          : now > e.closesAt
            ? 'MISSED'
            : 'AVAILABLE';

      if (attempt?.status === 'IN_PROGRESS') {
        state = attempt.deadlineAt <= now ? 'EXPIRED' : 'IN_PROGRESS';
      }

      if (attempt?.status === 'SUBMITTED') state = 'SUBMITTED';
      if (attempt?.status === 'EVALUATED') state = 'EVALUATED';

      const { attempts, ...safe } = e;
      return { ...safe, state, attempt: attempt ?? null };
    });
  }

  async details(examId: string, studentId: string) {
    const exam = await this.prisma.exam.findFirst({
      where: {
        id: examId,
        status: 'PUBLISHED',
        OR: [
          { eligibility: { none: {} } },
          { eligibility: { some: { studentId } } },
        ],
      },
      select: {
        id: true,
        title: true,
        subject: true,
        instructions: true,
        durationMinutes: true,
        opensAt: true,
        closesAt: true,
        maxMarks: true,
        passMarks: true,
        maxAttempts: true,
      },
    });

    if (!exam) {
      throw new NotFoundException('Examination not found or unavailable.');
    }

    return exam;
  }

  async start(examId: string, studentId: string, acknowledge: boolean) {
    if (!acknowledge) {
      throw new BadRequestException(
        'You must acknowledge the examination instructions.',
      );
    }

    return this.prisma
      .$transaction(
        async (tx) => {
          const now = new Date();

          const exam = await tx.exam.findFirst({
            where: {
              id: examId,
              status: 'PUBLISHED',
              OR: [
                { eligibility: { none: {} } },
                { eligibility: { some: { studentId } } },
              ],
            },
            include: {
              questions: {
                orderBy: { position: 'asc' },
                select: { id: true },
              },
            },
          });

          if (!exam) {
            throw new NotFoundException('Examination unavailable.');
          }

          if (now < exam.opensAt || now > exam.closesAt) {
            throw new BadRequestException(
              'The examination is outside its permitted window.',
            );
          }

          const existing = await tx.examAttempt.findUnique({
            where: { examId_studentId: { examId, studentId } },
          });

          if (existing) {
            if (
              existing.status === 'IN_PROGRESS' &&
              existing.deadlineAt > now
            ) {
              return { ...existing, resumed: true };
            }

            throw new ConflictException(
              'An attempt already exists and cannot be restarted.',
            );
          }

          const deadlineAt = new Date(
            Math.min(
              now.getTime() + exam.durationMinutes * 60000,
              exam.closesAt.getTime(),
            ),
          );

          const attempt = await tx.examAttempt.create({
            data: {
              examId,
              studentId,
              startedAt: now,
              deadlineAt,
              lastHeartbeatAt: now,
            },
          });

          await tx.examActivityLog.create({
            data: {
              attemptId: attempt.id,
              eventType: 'ATTEMPT_STARTED',
            },
          });

          return { ...attempt, resumed: false };
        },
        { isolationLevel: 'Serializable' },
      )
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2002' || error.code === 'P2034')
        ) {
          throw new ConflictException(
            'An attempt already exists or is being started. Please refresh before retrying.',
          );
        }
        throw error;
      });
  }

  async getAttempt(
    attemptId: string,
    user: { id: string; role: string },
  ) {
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: {
            questions: {
              orderBy: { position: 'asc' },
              include: {
                options: {
                  orderBy: { position: 'asc' },
                  select: {
                    id: true,
                    text: true,
                    position: true,
                  },
                },
              },
            },
          },
        },
        answers: true,
      },
    });

    if (!attempt) {
      throw new NotFoundException('Attempt not found.');
    }

    if (user.role === 'STUDENT' && attempt.studentId !== user.id) {
      throw new ForbiddenException();
    }
    if (
      user.role === 'FACULTY' &&
      attempt.exam.createdById !== user.id
    ) {
      throw new ForbiddenException(
        'Faculty may only view attempts for examinations they own.',
      );
    }

    if (user.role === 'STUDENT' && attempt.status !== 'IN_PROGRESS') {
      throw new ConflictException(
        'This attempt has already been submitted. Re-entry is not allowed.',
      );
    }
    if (attempt.status === 'IN_PROGRESS' && attempt.deadlineAt <= new Date()) {
      await this.finalize(attempt.id, 'TIMEOUT');
      if (user.role === 'STUDENT') {
        throw new ConflictException(
          'The examination deadline has passed and the attempt was submitted.',
        );
      }
    }

    const refreshed = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: {
            questions: {
              orderBy: { position: 'asc' },
              include: {
                options: {
                  orderBy: { position: 'asc' },
                  select: {
                    id: true,
                    text: true,
                    position: true,
                  },
                },
              },
            },
          },
        },
        answers: true,
      },
    });

    if (!refreshed) {
      throw new NotFoundException();
    }

    const { exam, ...rest } = refreshed;
    const responseAnswers =
      user.role === 'STUDENT'
        ? refreshed.answers.map(
            ({ awardedMarks: _awardedMarks, feedback: _feedback, ...answer }) =>
              answer,
          )
        : refreshed.answers;

    return {
      ...rest,
      answers: responseAnswers,
      result: undefined,
      serverNow: new Date(),
      exam: {
        id: exam.id,
        title: exam.title,
        durationMinutes: exam.durationMinutes,
        questions: exam.questions,
      },
    };
  }

  async saveAnswer(
    attemptId: string,
    questionId: string,
    studentId: string,
    dto: { selectedIds: string[]; textAnswer?: string | null },
  ) {
    const existing = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      select: { studentId: true, status: true, deadlineAt: true },
    });
    if (!existing || existing.studentId !== studentId) {
      throw new NotFoundException('Attempt not found.');
    }
    if (existing.status === 'IN_PROGRESS' && existing.deadlineAt <= new Date()) {
      await this.finalize(attemptId, 'TIMEOUT');
      throw new ConflictException('Attempt deadline passed and was submitted.');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const attempt = await tx.examAttempt.findUnique({
          where: { id: attemptId },
          select: { studentId: true, examId: true, status: true, deadlineAt: true },
        });
        if (!attempt || attempt.studentId !== studentId) {
          throw new NotFoundException('Attempt not found.');
        }
        if (
          attempt.status !== 'IN_PROGRESS' ||
          attempt.deadlineAt <= new Date()
        ) {
          throw new ConflictException('Attempt is no longer editable.');
        }

        const question = await tx.question.findFirst({
          where: { id: questionId, examId: attempt.examId },
          include: { options: true },
        });
        if (!question) {
          throw new NotFoundException(
            'Question not found in this examination.',
          );
        }
        if (question.type === 'DESCRIPTIVE' && dto.selectedIds.length) {
          throw new BadRequestException(
            'Descriptive answers cannot include option IDs.',
          );
        }
        const valid = new Set(question.options.map((option) => option.id));
        if (dto.selectedIds.some((id) => !valid.has(id))) {
          throw new BadRequestException(
            'One or more selected options are invalid.',
          );
        }

        return tx.studentAnswer.upsert({
          where: { attemptId_questionId: { attemptId, questionId } },
          create: {
            attemptId,
            questionId,
            selectedIds: dto.selectedIds,
            textAnswer: dto.textAnswer ?? null,
            version: 1,
          },
          update: {
            selectedIds: dto.selectedIds,
            textAnswer: dto.textAnswer ?? null,
            version: { increment: 1 },
          },
          select: {
            id: true,
            questionId: true,
            selectedIds: true,
            textAnswer: true,
            version: true,
            savedAt: true,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async flag(
    attemptId: string,
    questionId: string,
    studentId: string,
    flagged: boolean,
  ) {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: {
        id: attemptId,
        studentId,
        status: 'IN_PROGRESS',
        deadlineAt: { gt: new Date() },
      },
    });

    if (!attempt) {
      throw new ConflictException('Attempt is not editable.');
    }

    const question = await this.prisma.question.findFirst({
      where: { id: questionId, examId: attempt.examId },
    });

    if (!question) {
      throw new NotFoundException('Question not found.');
    }

    return this.prisma.studentAnswer.upsert({
      where: {
        attemptId_questionId: { attemptId, questionId },
      },
      create: {
        attemptId,
        questionId,
        selectedIds: [],
        isFlagged: flagged,
      },
      update: { isFlagged: flagged },
      select: {
        questionId: true,
        isFlagged: true,
      },
    });
  }

  async activity(
    attemptId: string,
    studentId: string,
    eventType: string,
    detail?: Record<string, unknown>,
  ) {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: {
        id: attemptId,
        studentId,
        status: 'IN_PROGRESS',
      },
    });

    if (!attempt) {
      throw new ConflictException('Attempt is not active.');
    }

    return this.prisma.examActivityLog.create({
      data: {
        attemptId,
        eventType,
        detail: detail as any,
      },
    });
  }

  async finalizeStudentAttempt(
    attemptId: string,
    studentId: string,
    reason: 'MANUAL' | 'TIMEOUT',
  ) {
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      select: { studentId: true },
    });
    if (!attempt || attempt.studentId !== studentId) {
      throw new NotFoundException('Attempt not found.');
    }
    return this.finalize(attemptId, reason);
  }

  async finalize(attemptId: string, reason: 'MANUAL' | 'TIMEOUT') {
    return this.prisma.$transaction(
      async (tx) => {
        const attempt = await tx.examAttempt.findUnique({
          where: { id: attemptId },
          include: {
            exam: {
              include: {
                questions: {
                  include: { options: true },
                },
              },
            },
            answers: true,
            result: true,
          },
        });

        if (!attempt) {
          throw new NotFoundException('Attempt not found.');
        }

        if (attempt.status !== 'IN_PROGRESS') {
          return {
            attemptId,
            status: attempt.status,
            alreadyFinalized: true,
            result: attempt.result,
          };
        }

        if (reason === 'MANUAL' && attempt.deadlineAt <= new Date()) {
          reason = 'TIMEOUT';
        }

        if (reason === 'TIMEOUT' && attempt.deadlineAt > new Date()) {
          throw new BadRequestException(
            'The server deadline has not expired.',
          );
        }

        const submittedAt = new Date();
        const finalized = await tx.examAttempt.updateMany({
          where: { id: attemptId, status: 'IN_PROGRESS' },
          data: {
            status: attempt.exam.questions.some(
              (question) => question.type === 'DESCRIPTIVE',
            )
              ? 'SUBMITTED'
              : 'EVALUATED',
            submittedAt,
            submissionReason: reason,
          },
        });
        if (finalized.count !== 1) {
          throw new ConflictException('This attempt has already been submitted.');
        }

        const answerMap = new Map(
          attempt.answers.map((a) => [a.questionId, a]),
        );

        let objectiveMarks = 0;
        let hasDescriptive = false;

        for (const q of attempt.exam.questions) {
          const a = answerMap.get(q.id);

          if (q.type === 'DESCRIPTIVE') {
            hasDescriptive = true;
            continue;
          }

          const chosen = new Set(a?.selectedIds ?? []);
          const correct = new Set(
            q.options.filter((o) => o.isCorrect).map((o) => o.id),
          );

          const isCorrect =
            chosen.size > 0 &&
            correct.size > 0 &&
            chosen.size === correct.size &&
            [...chosen].every((id) => correct.has(id));

          let awardedMarks = 0;
          if (isCorrect) {
            awardedMarks = q.marks;
          } else if (chosen.size && attempt.exam.negativeMarking) {
            awardedMarks = -(
              q.negativeMarks || attempt.exam.negativeMarkValue
            );
          }
          objectiveMarks += awardedMarks;
          await tx.studentAnswer.upsert({
            where: {
              attemptId_questionId: {
                attemptId,
                questionId: q.id,
              },
            },
            create: {
              attemptId,
              questionId: q.id,
              selectedIds: [],
              awardedMarks,
            },
            update: { awardedMarks },
          });
        }

        objectiveMarks =
          Math.round(Math.max(0, objectiveMarks) * 100) / 100;

        const result = await tx.result.upsert({
          where: { attemptId },
          create: {
            attemptId,
            objectiveMarks,
            status: hasDescriptive ? 'PENDING_EVALUATION' : 'EVALUATED',
            totalMarks: hasDescriptive ? null : objectiveMarks,
            passed: hasDescriptive
              ? null
              : objectiveMarks >= attempt.exam.passMarks,
          },
          update: {},
        });

        await tx.examActivityLog.create({
          data: {
            attemptId,
            eventType:
              reason === 'TIMEOUT' ? 'AUTO_SUBMITTED' : 'MANUALLY_SUBMITTED',
          },
        });

        return {
          attemptId,
          status: hasDescriptive ? 'SUBMITTED' : 'EVALUATED',
          submissionReason: reason,
          result,
        };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async studentResults(studentId: string) {
    return this.prisma.result.findMany({
      where: {
        attempt: { studentId },
        status: 'PUBLISHED',
      },
      include: {
        attempt: {
          include: {
            answers: {
              orderBy: { question: { position: 'asc' } },
              select: {
                questionId: true,
                awardedMarks: true,
                feedback: true,
                question: {
                  select: { prompt: true, position: true, marks: true },
                },
              },
            },
            exam: {
              select: {
                title: true,
                subject: true,
                maxMarks: true,
                passMarks: true,
              },
            },
          },
        },
      },
      orderBy: { publishedAt: 'desc' },
    });
  }

  async publishResult(
    resultId: string,
    actorId: string,
    actorRole: string = 'FACULTY',
  ) {
    if (actorRole === 'FACULTY') {
      await this.assertApprovedFaculty(actorId);
    }
    const result = await this.prisma.result.findUnique({
      where: { id: resultId },
      include: {
        attempt: {
          include: { exam: true },
        },
      },
    });

    if (!result) {
      throw new NotFoundException('Result not found.');
    }

    if (
      actorRole !== 'ADMIN' &&
      result.attempt.exam.createdById !== actorId
    ) {
      throw new ForbiddenException(
        'Only the exam owner may publish this result.',
      );
    }

    if (result.status !== 'EVALUATED' || result.totalMarks === null) {
      throw new BadRequestException(
        'Complete descriptive evaluation before publishing.',
      );
    }
    const update = await this.prisma.result.updateMany({
      where: { id: resultId, status: 'EVALUATED' },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    if (update.count !== 1) {
      throw new ConflictException('This result is already published.');
    }
    return this.prisma.result.findUniqueOrThrow({ where: { id: resultId } });
  }
}
