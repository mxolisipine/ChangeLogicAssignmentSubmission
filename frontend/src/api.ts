/**
 * Minimal API client.
 *
 * All requests go through the Vite proxy: /api/* → http://localhost:3000/*
 * The X-User-Id header is set on every authenticated call.
 * There is no JWT — this is the deliberate local-auth strategy documented in SPEC.md §5.
 */

import type {
  ActiveSurvey,
  AnswerPayload,
  CurrentUser,
  SubmitResult,
  SurveySummary,
  UserListItem,
} from './types';

/** The currently selected user id, written at login and read on every request. */
let currentUserId: string | null = null;

export function setCurrentUserId(id: string | null): void {
  currentUserId = id;
}

// ─── Error type ──────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (currentUserId) {
    headers['x-user-id'] = currentUserId;
  }

  const response = await fetch(`/api${path}`, { ...options, headers });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (body.message) {
        message = Array.isArray(body.message)
          ? body.message.join('; ')
          : body.message;
      }
    } catch {
      // body wasn't JSON — use the default message
    }
    throw new ApiError(response.status, message);
  }

  // 204 No Content has no body
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json() as Promise<T>;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/** GET /auth/users — no auth required */
export function getUsers(): Promise<UserListItem[]> {
  return apiFetch<UserListItem[]>('/auth/users');
}

/** GET /auth/me — requires X-User-Id */
export function getMe(): Promise<CurrentUser> {
  return apiFetch<CurrentUser>('/auth/me');
}

/** GET /surveys/active — requires X-User-Id */
export function getActiveSurvey(): Promise<ActiveSurvey> {
  return apiFetch<ActiveSurvey>('/surveys/active');
}

/** POST /surveys/:id/responses — requires X-User-Id, MEMBER only */
export function submitResponse(
  surveyId: string,
  answers: AnswerPayload[],
): Promise<SubmitResult> {
  return apiFetch<SubmitResult>(`/surveys/${surveyId}/responses`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}

/** GET /surveys/:id/summary — requires X-User-Id, MANAGER only */
export function getSummary(surveyId: string): Promise<SurveySummary> {
  return apiFetch<SurveySummary>(`/surveys/${surveyId}/summary`);
}
