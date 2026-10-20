
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AdminUsersQueryDto, LoginDto, RegisterDto } from './dto';
import { JwtGuard, requireRole } from './jwt.guard';

@ApiTags('authentication')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @UseGuards(JwtGuard)
  @Get('admin/stats')
  adminStats(@Req() req: any) {
    requireRole('ADMIN')(req);
    return this.auth.getAdminStats();
  }

  @UseGuards(JwtGuard)
  @Get('admin/users')
  adminUsers(@Req() req: any, @Query() query: AdminUsersQueryDto) {
    requireRole('ADMIN')(req);
    return this.auth.listUsers(query);
  }

  @UseGuards(JwtGuard)
  @Get('admin/pending-users')
  pendingUsers(@Req() req: any) {
    requireRole('ADMIN')(req);
    return this.auth.listPendingUsers();
  }

  @UseGuards(JwtGuard)
  @Patch('admin/users/:userId/approve')
  approveUser(@Param('userId') userId: string, @Req() req: any) {
    requireRole('ADMIN')(req);
    return this.auth.approveRegistration(userId, req.user.id);
  }

  @UseGuards(JwtGuard)
  @Patch('admin/users/:userId/reject')
  rejectUser(@Param('userId') userId: string, @Req() req: any) {
    requireRole('ADMIN')(req);
    return this.auth.rejectRegistration(userId, req.user.id);
  }

  @UseGuards(JwtGuard)
  @Patch('admin/users/:userId/activate')
  activateUser(
    @Param('userId') userId: string,
    @Req() req: any,
  ) {
    requireRole('ADMIN')(req);
    return this.auth.activateUser(userId, req.user.id);
  }

  @UseGuards(JwtGuard)
  @Patch('admin/users/:userId/deactivate')
  deactivateUser(@Param('userId') userId: string, @Req() req: any) {
    requireRole('ADMIN')(req);
    return this.auth.deactivateUser(userId, req.user.id);
  }
}
