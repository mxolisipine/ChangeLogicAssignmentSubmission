import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { CurrentUser } from './current-user.interface';

export const AUTH_HEADER = 'x-user-id';

/**
 * Global authentication guard.
 *
 * Reads the X-User-Id header, looks up the user in the database, and
 * attaches CurrentUser to request.user.
 *
 * organizationId is ALWAYS derived from the database record — it is never
 * read from the request body, query string, or any other client-supplied source.
 *
 * Routes decorated with @Public() bypass this guard entirely.
 *
 * Returns HTTP 401 if:
 *   - The X-User-Id header is absent or empty (and route is not public).
 *   - No user record exists for the supplied ID.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Allow routes explicitly marked @Public() through without a token
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user: CurrentUser }>();

    const userId = request.headers[AUTH_HEADER];

    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      throw new UnauthorizedException('X-User-Id header is required');
    }

    // Always load from DB — organizationId and role come from the database only
    const user = await this.userRepository.findOne({
      where: { id: userId.trim() },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    request.user = {
      id: user.id,
      organizationId: user.organizationId,
      role: user.role,
      name: user.name,
    };

    return true;
  }
}
