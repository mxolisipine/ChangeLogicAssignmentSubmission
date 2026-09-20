import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Mark a route handler as public — the global AuthGuard will skip it.
 *
 * Usage:
 *   @Public()
 *   @Get('users')
 *   getUsers() { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
