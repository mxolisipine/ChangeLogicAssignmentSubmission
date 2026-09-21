import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../entities/user.entity';
import { AuthGuard, AUTH_HEADER } from './auth.guard';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal ExecutionContext mock for a route that is NOT @Public().
 * The supplied headers object represents request.headers.
 */
function makeContext(
  headers: Record<string, string> = {},
  isPublic = false,
): ExecutionContext {
  const request = { headers, user: undefined as unknown };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
    // store request so tests can inspect request.user after canActivate
    _request: request,
  } as unknown as ExecutionContext & { _request: typeof request };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MOCK_USER: User = {
  id: 'bbbbbbbb-0000-0000-0000-000000000001',
  organizationId: 'aaaaaaaa-0000-0000-0000-000000000001',
  role: UserRole.MANAGER,
  name: 'Alice',
  email: 'alice@acme.example',
  createdAt: new Date(),
  organization: null as never,
  responses: [],
};

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let userRepo: jest.Mocked<Pick<Repository<User>, 'findOne'>>;
  let reflector: Reflector;

  beforeEach(async () => {
    // Create a partial mock — only findOne is exercised by the guard
    const mockRepo = {
      findOne: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthGuard,
        {
          provide: getRepositoryToken(User),
          useValue: mockRepo,
        },
        Reflector,
      ],
    }).compile();

    guard = moduleRef.get(AuthGuard);
    userRepo = mockRepo as jest.Mocked<Pick<Repository<User>, 'findOne'>>;
    reflector = moduleRef.get(Reflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Public routes ───────────────────────────────────────────────────────────

  it('allows public routes through without touching the repository', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = makeContext({}); // no header at all

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(userRepo.findOne).not.toHaveBeenCalled();
  });

  // ── Valid identity ──────────────────────────────────────────────────────────

  it('returns true and populates request.user when a valid X-User-Id is supplied', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    (userRepo.findOne as jest.Mock).mockResolvedValue(MOCK_USER);

    const ctx = makeContext({ [AUTH_HEADER]: MOCK_USER.id }) as ExecutionContext & {
      _request: { user: unknown };
    };

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);

    // Verify the repository was queried with the correct id
    expect(userRepo.findOne).toHaveBeenCalledWith({
      where: { id: MOCK_USER.id },
    });

    // Verify CurrentUser shape on request.user
    const user = (ctx as unknown as { _request: { user: unknown } })._request.user as {
      id: string;
      organizationId: string;
      role: UserRole;
      name: string;
    };
    expect(user.id).toBe(MOCK_USER.id);
    expect(user.organizationId).toBe(MOCK_USER.organizationId);
    expect(user.role).toBe(UserRole.MANAGER);
    expect(user.name).toBe(MOCK_USER.name);
  });

  it('never copies organizationId from the request — always uses the DB value', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    (userRepo.findOne as jest.Mock).mockResolvedValue(MOCK_USER);

    // Attacker supplies a different org id in a custom header — must be ignored
    const ctx = makeContext({
      [AUTH_HEADER]: MOCK_USER.id,
      'x-organization-id': 'attacker-org-id',
    }) as ExecutionContext & { _request: { user: unknown } };

    await guard.canActivate(ctx);

    const user = (ctx as unknown as { _request: { user: { organizationId: string } } })
      ._request.user;
    expect(user.organizationId).toBe(MOCK_USER.organizationId);
    expect(user.organizationId).not.toBe('attacker-org-id');
  });

  // ── Missing header ──────────────────────────────────────────────────────────

  it('throws 401 when the X-User-Id header is missing', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    const ctx = makeContext({}); // no header

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(userRepo.findOne).not.toHaveBeenCalled();
  });

  it('throws 401 when the X-User-Id header is an empty string', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    const ctx = makeContext({ [AUTH_HEADER]: '   ' }); // whitespace only

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(userRepo.findOne).not.toHaveBeenCalled();
  });

  // ── Unknown user id ─────────────────────────────────────────────────────────

  it('throws 401 when the user ID does not exist in the database', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    (userRepo.findOne as jest.Mock).mockResolvedValue(null); // not found

    const ctx = makeContext({ [AUTH_HEADER]: 'non-existent-uuid' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(userRepo.findOne).toHaveBeenCalledTimes(1);
  });

  it('throws 401 with a descriptive message when the user is not found', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    (userRepo.findOne as jest.Mock).mockResolvedValue(null);

    const ctx = makeContext({ [AUTH_HEADER]: 'some-id' });

    await expect(guard.canActivate(ctx)).rejects.toThrow('User not found');
  });

  it('throws 401 with a descriptive message when the header is absent', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    const ctx = makeContext({});

    await expect(guard.canActivate(ctx)).rejects.toThrow('X-User-Id header is required');
  });
});
