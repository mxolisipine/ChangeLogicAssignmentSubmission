import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { CurrentUser } from './current-user.interface';

/**
 * Parameter decorator that extracts the CurrentUser object from the request.
 *
 * Usage:
 *   @Get('me')
 *   getMe(@CurrentUserParam() user: CurrentUser) { ... }
 *
 * The object is placed on request.user by AuthGuard before this runs.
 */
export const CurrentUserParam = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user: CurrentUser }>();
    return request.user;
  },
);
