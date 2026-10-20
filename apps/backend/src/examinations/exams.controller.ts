import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtGuard, requireRole } from '../auth/jwt.guard';
import {
  ActivityDto,
  EvaluateAttemptDto,
  FlagDto,
  SaveAnswerDto,
  SaveExamDto,
} from './dto';
import { ExamsService } from './exams.service';

@ApiTags('examinations')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller()
export class ExamsController {
  constructor(private exams: ExamsService) {}

  @Get('student/dashboard')
  studentDashboard(@Req() req: any) {
    requireRole('STUDENT')(req);
    return this.exams.studentDashboard(req.user.id);
  }

  @Get('faculty/dashboard')
  dashboard(@Req() req: any) {
    requireRole('FACULTY')(req);
    return this.exams.facultyDashboard(req.user.id);
  }

  @Get('faculty/exams')
  facultyExams(@Req() req: any) {
    requireRole('FACULTY')(req);
    return this.exams.listFacultyExams(req.user.id);
  }

  @Post('faculty/exams')
  createExam(@Body() dto: SaveExamDto, @Req() req: any) {
    requireRole('FACULTY')(req);
    return this.exams.createFacultyExam(req.user.id, dto);
  }

  @Patch('faculty/exams/:examId')
  updateExam(
    @Param('examId') examId: string,
    @Body() dto: SaveExamDto,
    @Req() req: any,
  ) {
    requireRole('FACULTY')(req);
    return this.exams.updateFacultyExam(req.user.id, examId, dto);
  }

  @Delete('faculty/exams/:examId')
  deleteExam(@Param('examId') examId: string, @Req() req: any) {
    requireRole('FACULTY')(req);
    return this.exams.deleteFacultyExam(req.user.id, examId);
  }

  @Patch('faculty/exams/:examId/publish')
  publishExam(@Param('examId') examId: string, @Req() req: any) {
    requireRole('FACULTY')(req);
    return this.exams.publishFacultyExam(req.user.id, examId);
  }

  @Patch('faculty/exams/:examId/close')
  closeExam(@Param('examId') examId: string, @Req() req: any) {
    requireRole('FACULTY')(req);
    return this.exams.closeFacultyExam(req.user.id, examId);
  }

  @Get('faculty/attempts')
  facultyAttempts(
    @Req() req: any,
    @Query('examId') examId?: string,
  ) {
    requireRole('FACULTY')(req);
    return this.exams.listFacultyAttempts(req.user.id, examId);
  }

  @Patch('faculty/attempts/:attemptId/evaluate')
  evaluateAttempt(
    @Param('attemptId') attemptId: string,
    @Body() dto: EvaluateAttemptDto,
    @Req() req: any,
  ) {
    requireRole('FACULTY')(req);
    return this.exams.evaluateAttempt(req.user.id, attemptId, dto.answers);
  }

  @Get('exams')
  list(@Req() req: any) {
    requireRole('STUDENT')(req);
    return this.exams.listEligible(req.user.id);
  }

  @Get('exams/:examId')
  details(@Param('examId') id: string, @Req() req: any) {
    requireRole('STUDENT')(req);
    return this.exams.details(id, req.user.id);
  }

  @Post('exams/:examId/start')
  start(
    @Param('examId') id: string,
    @Body() body: { acknowledge: boolean },
    @Req() req: any,
  ) {
    requireRole('STUDENT')(req);
    return this.exams.start(id, req.user.id, body.acknowledge === true);
  }

  @Get('attempts/:attemptId')
  attempt(@Param('attemptId') id: string, @Req() req: any) {
    requireRole('STUDENT', 'FACULTY', 'ADMIN')(req);
    return this.exams.getAttempt(id, req.user);
  }

  @Post('attempts/:attemptId/questions/:questionId/answer')
  answer(
    @Param('attemptId') attemptId: string,
    @Param('questionId') questionId: string,
    @Body() dto: SaveAnswerDto,
    @Req() req: any,
  ) {
    requireRole('STUDENT')(req);
    return this.exams.saveAnswer(attemptId, questionId, req.user.id, dto);
  }

  @Post('attempts/:attemptId/questions/:questionId/flag')
  flag(
    @Param('attemptId') attemptId: string,
    @Param('questionId') questionId: string,
    @Body() dto: FlagDto,
    @Req() req: any,
  ) {
    requireRole('STUDENT')(req);
    return this.exams.flag(attemptId, questionId, req.user.id, dto.flagged);
  }

  @Post('attempts/:attemptId/activity')
  activity(
    @Param('attemptId') attemptId: string,
    @Body() dto: ActivityDto,
    @Req() req: any,
  ) {
    requireRole('STUDENT')(req);
    return this.exams.activity(
      attemptId,
      req.user.id,
      dto.eventType,
      dto.detail,
    );
  }

  @Post('attempts/:attemptId/submit')
  submit(@Param('attemptId') id: string, @Req() req: any) {
    requireRole('STUDENT')(req);
    return this.exams.finalizeStudentAttempt(id, req.user.id, 'MANUAL');
  }

  @Get('results/me')
  results(@Req() req: any) {
    requireRole('STUDENT')(req);
    return this.exams.studentResults(req.user.id);
  }

  @Post('results/:resultId/publish')
  publish(@Param('resultId') id: string, @Req() req: any) {
    requireRole('FACULTY', 'ADMIN')(req);
    return this.exams.publishResult(id, req.user.id, req.user.role);
  }
}
