import { Controller, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CurrentUserParam } from './current-user.decorator';
import { Public } from './public.decorator';
import type { CurrentUser } from './current-user.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * GET /auth/me
   *
   * Returns the resolved identity for the authenticated caller.
   * Used by the React app immediately after login to determine which
   * screen to render (manager summary vs member survey).
   *
   * Requires X-User-Id header (protected by global AuthGuard).
   */
  @Get('me')
  getMe(@CurrentUserParam() currentUser: CurrentUser) {
    return this.authService.getMe(currentUser);
  }

  /**
   * GET /auth/users
   *
   * Returns all seeded users for the login dropdown.
   * Unauthenticated — no X-User-Id header needed.
   */
  @Public()
  @Get('users')
  getUsers() {
    return this.authService.getAllUsers();
  }
}
