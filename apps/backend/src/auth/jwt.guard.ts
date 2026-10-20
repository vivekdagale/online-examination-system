import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.service';
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private jwt: JwtService, private prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const header = req.headers.authorization as string | undefined;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Bearer token required.');
    try {
      const payload = await this.jwt.verifyAsync(header.slice(7));
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, role: true, status: true, email: true } });
      if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Account is inactive or unavailable.');
      req.user = user;
      return true;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('Invalid or expired access token.');
    }
  }
}
export function requireRole(...roles: string[]) {
  return (req: any) => { if (!req.user || !roles.includes(req.user.role)) throw new ForbiddenException('Insufficient role permissions.'); };
}
