import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { CurrentUser } from './current-user.interface';
import { ROLES_KEY } from './roles.decorator';
import { UserRole } from '../entities/user.entity';

/**
 * Authorization guard — runs after AuthGuard has resolved CurrentUser.
 *
 * Checks that request.user.role is in the set of roles declared via @Roles().
 * Returns HTTP 403 Forbidden if the role does not match.
 *
 * Routes with no @Roles() decorator pass through unchecked.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No role restriction on this handler — allow through
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user: CurrentUser }>();
    const user = request.user;

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `This endpoint requires one of these roles: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
