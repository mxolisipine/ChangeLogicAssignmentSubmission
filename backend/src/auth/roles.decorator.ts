import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../entities/user.entity';

export const ROLES_KEY = 'roles';

/**
 * Declare which roles are permitted to call a handler.
 *
 * Usage:
 *   @Roles(UserRole.MANAGER)
 *   @Post()
 *   createSurvey() { ... }
 *
 * Enforced by RolesGuard, which runs after AuthGuard has resolved CurrentUser.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
