import { UserRole } from '../entities/user.entity';

/**
 * Resolved identity attached to every authenticated request.
 *
 * Populated by AuthGuard from the database row — organizationId is ALWAYS
 * sourced from the DB, never from a header, query param, or request body.
 */
export interface CurrentUser {
  id: string;
  organizationId: string;
  role: UserRole;
  name: string;
}
