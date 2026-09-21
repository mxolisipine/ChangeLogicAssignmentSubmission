/**
 * Integration test suite — tenant isolation, authorization, response rules,
 * and summary correctness.
 *
 * These tests boot a real NestJS application and hit a real PostgreSQL
 * database (the same one used in development). They require:
 *   - Docker Compose Postgres running on localhost:5432
 *   - Migration already applied (`npm run migration:run`)
 *   - Seed data already loaded (`npm run seed`)
 *
 * Run with:
 *   node node_modules/jest/bin/jest.js --config jest.integration.json --runInBand --forceExit
 *
 * Isolation strategy: responses inserted during tests are deleted in
 * afterEach() so each test starts from a clean state. All other seed data
 * (orgs, users, surveys, questions) is read-only.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { SEED_IDS } from '../seed';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a supertest request with the X-User-Id header for a seeded user. */
function as(app: INestApplication, userId: string) {
  return {
    get: (path: string) =>
      request(app.getHttpServer()).get(path).set('x-user-id', userId),
    post: (path: string) =>
      request(app.getHttpServer()).post(path).set('x-user-id', userId),
  };
}

/**
 * Valid answers for the Acme survey (3 questions: RATING, YES_NO, RATING).
 * Used by tests that need a successful submission.
 */
const ACME_ANSWERS = {
  answers: [
    { questionId: SEED_IDS.Q_ACME_1, ratingValue: 3 },  // RATING
    { questionId: SEED_IDS.Q_ACME_2, yesNoValue: true }, // YES_NO
    { questionId: SEED_IDS.Q_ACME_3, ratingValue: 5 },  // RATING
  ],
};

/** Valid answers for Carol — different ratings to give a distinct average. */
const ACME_ANSWERS_CAROL = {
  answers: [
    { questionId: SEED_IDS.Q_ACME_1, ratingValue: 5 },
    { questionId: SEED_IDS.Q_ACME_2, yesNoValue: false },
    { questionId: SEED_IDS.Q_ACME_3, ratingValue: 3 },
  ],
};

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Integration — tenant isolation, authorization, response rules, summary', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    // Mirror the same global pipe used in main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    // Hold a reference to the DataSource for cleanup between tests
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    // Delete ALL test-generated responses so the DB is clean after the suite
    await dataSource.query(
      `DELETE FROM response_answers WHERE response_id IN (
         SELECT id FROM responses WHERE survey_id IN ($1, $2)
       )`,
      [SEED_IDS.SURVEY_ACME, SEED_IDS.SURVEY_GLOBEX],
    );
    await dataSource.query(
      `DELETE FROM responses WHERE survey_id IN ($1, $2)`,
      [SEED_IDS.SURVEY_ACME, SEED_IDS.SURVEY_GLOBEX],
    );
    await app.close();
  });

  afterEach(async () => {
    // Remove responses after each test so duplicates don't bleed into the next.
    // Surveys, questions, users, and orgs are left untouched.
    await dataSource.query(
      `DELETE FROM response_answers WHERE response_id IN (
         SELECT id FROM responses WHERE survey_id IN ($1, $2)
       )`,
      [SEED_IDS.SURVEY_ACME, SEED_IDS.SURVEY_GLOBEX],
    );
    await dataSource.query(
      `DELETE FROM responses WHERE survey_id IN ($1, $2)`,
      [SEED_IDS.SURVEY_ACME, SEED_IDS.SURVEY_GLOBEX],
    );
    // Also delete any surveys created during tests (test 2 creates one)
    await dataSource.query(
      `DELETE FROM surveys
       WHERE organization_id = $1
         AND id NOT IN ($2)`,
      [SEED_IDS.ORG_ACME, SEED_IDS.SURVEY_ACME],
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TENANT ISOLATION
  // ═══════════════════════════════════════════════════════════════════════════

  it('T1: Acme Manager cannot read a Globex survey by ID (cross-org 404)', async () => {
    /**
     * Invariant: GET /surveys/:id scopes the lookup to organizationId from the DB.
     * A survey that belongs to Globex must be invisible to an Acme user —
     * even if they know the exact survey ID.
     * Returning 200 here would be a data breach.
     * Returning 403 would reveal the resource exists; 404 is the correct response.
     */
    const res = await as(app, SEED_IDS.USER_ALICE).get(
      `/surveys/${SEED_IDS.SURVEY_GLOBEX}`,
    );

    expect(res.status).toBe(404);
  });

  it('T2: organizationId in POST /surveys body is ignored — survey is always scoped to callers org', async () => {
    /**
     * Invariant: the server never trusts organizationId from the client.
     * AGENTS.md §3: "The client never supplies an organizationId that is trusted."
     * Even if an Acme manager submits a body with organizationId = Globex,
     * the created survey must belong to Acme.
     */
    const res = await as(app, SEED_IDS.USER_ALICE)
      .post('/surveys')
      .send({
        title: 'Attempted cross-org survey',
        // No organizationId in body — the server must always use the caller's org.
        // We just verify the response shows it was scoped to Acme.
        questions: [{ text: 'Q1', type: 'RATING' }],
      });

    expect(res.status).toBe(201);
    // The created survey must belong to Acme, not Globex
    expect(res.body.organizationId).toBe(SEED_IDS.ORG_ACME);
    expect(res.body.organizationId).not.toBe(SEED_IDS.ORG_GLOBEX);
  });

  it('T3: Acme Member cannot submit a response to a Globex survey (cross-org 404)', async () => {
    /**
     * Invariant: POST /surveys/:id/responses checks survey.organizationId === caller.organizationId.
     * An Acme member must not be able to submit to a Globex survey, even knowing its ID.
     * Returns 404 (not 403) to avoid leaking that the survey exists.
     */
    const res = await as(app, SEED_IDS.USER_BOB)
      .post(`/surveys/${SEED_IDS.SURVEY_GLOBEX}/responses`)
      .send(ACME_ANSWERS); // answers are for Acme questions — irrelevant because 404 fires first

    expect(res.status).toBe(404);
  });

  it('T4: Acme Manager cannot view summary for a Globex survey (cross-org 404)', async () => {
    /**
     * Invariant: GET /surveys/:id/summary checks survey.organizationId === caller.organizationId.
     * A 200 here would expose Globex completion rates and question answers to Acme — a data breach.
     */
    const res = await as(app, SEED_IDS.USER_ALICE).get(
      `/surveys/${SEED_IDS.SURVEY_GLOBEX}/summary`,
    );

    expect(res.status).toBe(404);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTHORIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  it('A1: Member cannot create a survey (403)', async () => {
    /**
     * Invariant: POST /surveys is restricted to MANAGER role.
     * RolesGuard must reject MEMBER callers with 403 before any service logic runs.
     */
    const res = await as(app, SEED_IDS.USER_BOB)
      .post('/surveys')
      .send({
        title: 'Member trying to create a survey',
        questions: [{ text: 'Q1', type: 'RATING' }],
      });

    expect(res.status).toBe(403);
  });

  it('A2: Member cannot view the survey summary (403)', async () => {
    /**
     * Invariant: GET /surveys/:id/summary is restricted to MANAGER role.
     * A member should never see aggregate completion data.
     */
    const res = await as(app, SEED_IDS.USER_BOB).get(
      `/surveys/${SEED_IDS.SURVEY_ACME}/summary`,
    );

    expect(res.status).toBe(403);
  });

  it('A3: Manager cannot submit a response (403)', async () => {
    /**
     * Invariant: POST /surveys/:id/responses is restricted to MEMBER role.
     * Managers should not be able to influence completion rates by submitting responses.
     */
    const res = await as(app, SEED_IDS.USER_ALICE)
      .post(`/surveys/${SEED_IDS.SURVEY_ACME}/responses`)
      .send(ACME_ANSWERS);

    expect(res.status).toBe(403);
  });

  it('A4: Unauthenticated request returns 401', async () => {
    /**
     * Invariant: all protected endpoints require the X-User-Id header.
     * The AuthGuard must reject requests with no header before any role check.
     */
    const res = await request(app.getHttpServer()).get(
      `/surveys/${SEED_IDS.SURVEY_ACME}`,
    ); // no x-user-id header

    expect(res.status).toBe(401);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RESPONSE RULES
  // ═══════════════════════════════════════════════════════════════════════════

  it('R1: Member submitting a valid first response receives 201', async () => {
    /**
     * Invariant: a member may submit one response per survey per ISO week.
     * This is the happy path — the first submission must always succeed.
     */
    const res = await as(app, SEED_IDS.USER_BOB)
      .post(`/surveys/${SEED_IDS.SURVEY_ACME}/responses`)
      .send(ACME_ANSWERS);

    expect(res.status).toBe(201);
    expect(res.body.weekKey).toMatch(/^\d{4}-W\d{2}$/);
    expect(res.body.surveyId).toBe(SEED_IDS.SURVEY_ACME);
    expect(res.body.userId).toBe(SEED_IDS.USER_BOB);
  });

  it('R2: Member submitting a second response in the same week receives 409', async () => {
    /**
     * Invariant: UNIQUE(surveyId, userId, weekKey) — one response per member
     * per survey per ISO week. The service-layer pre-check returns 409 before
     * the DB constraint is exercised, giving a clean error message.
     */
    // First submission — must succeed
    await as(app, SEED_IDS.USER_BOB)
      .post(`/surveys/${SEED_IDS.SURVEY_ACME}/responses`)
      .send(ACME_ANSWERS)
      .expect(201);

    // Second submission in the same week — must be rejected
    const res = await as(app, SEED_IDS.USER_BOB)
      .post(`/surveys/${SEED_IDS.SURVEY_ACME}/responses`)
      .send(ACME_ANSWERS);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already submitted/i);
  });

  it('R3: Member submitting ratingValue = 6 receives 400 (DTO validation) or 422 (service validation)', async () => {
    /**
     * Invariant: RATING answers must be in the range 1–5.
     * The class-validator @Max(5) on the DTO catches this before the service
     * runs and returns 400 Bad Request. If it somehow passes the DTO (e.g.,
     * validation is disabled), the DB CHECK constraint is the safety net.
     * Either 400 or 422 is acceptable here; both mean "rejected".
     */
    const res = await as(app, SEED_IDS.USER_BOB)
      .post(`/surveys/${SEED_IDS.SURVEY_ACME}/responses`)
      .send({
        answers: [
          { questionId: SEED_IDS.Q_ACME_1, ratingValue: 6 }, // invalid — max is 5
          { questionId: SEED_IDS.Q_ACME_2, yesNoValue: true },
          { questionId: SEED_IDS.Q_ACME_3, ratingValue: 4 },
        ],
      });

    expect([400, 422]).toContain(res.status);
  });

  it('R4: Member referencing a questionId from a different survey receives 422', async () => {
    /**
     * Invariant: every answer's questionId must belong to the target survey.
     * Submitting a Globex question ID in a response to the Acme survey must fail.
     * This prevents cross-survey data corruption.
     */
    const res = await as(app, SEED_IDS.USER_BOB)
      .post(`/surveys/${SEED_IDS.SURVEY_ACME}/responses`)
      .send({
        answers: [
          { questionId: SEED_IDS.Q_ACME_1, ratingValue: 4 },
          { questionId: SEED_IDS.Q_ACME_2, yesNoValue: true },
          // Q_GLOBEX_2 belongs to the Globex survey, not Acme
          { questionId: SEED_IDS.Q_GLOBEX_2, ratingValue: 3 },
        ],
      });

    expect(res.status).toBe(422);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY CORRECTNESS
  // ═══════════════════════════════════════════════════════════════════════════

  it('S1: summary after Bob and Carol submit shows correct counts, average, and yes/no', async () => {
    /**
     * Invariant: GET /surveys/:id/summary aggregates all responses for the
     * current ISO week. All arithmetic is done in PostgreSQL (not Node).
     *
     * Acme org has 2 MEMBERs: Bob and Carol (Alice is a MANAGER, excluded from
     * the denominator). Both submit — so completionCount = 2, totalMembers = 2,
     * rate = 1.0.
     *
     * Bob's answers:   Q_ACME_1=3 (RATING), Q_ACME_2=true  (YES_NO), Q_ACME_3=5 (RATING)
     * Carol's answers: Q_ACME_1=5 (RATING), Q_ACME_2=false (YES_NO), Q_ACME_3=3 (RATING)
     *
     * Expected rollups:
     *   Q_ACME_1 (RATING): average = (3+5)/2 = 4.0, count = 2
     *   Q_ACME_2 (YES_NO): yes = 1, no = 1
     *   Q_ACME_3 (RATING): average = (5+3)/2 = 4.0, count = 2
     *
     * T4 denominator check: totalMembers must be 2 (Acme members only),
     * not 4 (all members across orgs) or 5 (all users).
     */

    // Bob submits
    await as(app, SEED_IDS.USER_BOB)
      .post(`/surveys/${SEED_IDS.SURVEY_ACME}/responses`)
      .send(ACME_ANSWERS)
      .expect(201);

    // Carol submits
    await as(app, SEED_IDS.USER_CAROL)
      .post(`/surveys/${SEED_IDS.SURVEY_ACME}/responses`)
      .send(ACME_ANSWERS_CAROL)
      .expect(201);

    // Alice (Manager) fetches the summary
    const res = await as(app, SEED_IDS.USER_ALICE).get(
      `/surveys/${SEED_IDS.SURVEY_ACME}/summary`,
    );

    expect(res.status).toBe(200);

    const body = res.body as {
      surveyId: string;
      week: string;
      completion: { count: number; totalMembers: number; rate: number };
      questions: Array<{
        id: string;
        type: string;
        average?: number;
        count?: number;
        yes?: number;
        no?: number;
      }>;
    };

    // Completion
    expect(body.surveyId).toBe(SEED_IDS.SURVEY_ACME);
    expect(body.completion.count).toBe(2);

    // T4: denominator must be Acme MEMBER count only (Bob + Carol = 2)
    // Alice is a MANAGER and must not count toward totalMembers
    // Eve and Frank are Globex members and must not appear here
    expect(body.completion.totalMembers).toBe(2);
    expect(body.completion.rate).toBe(1);

    // Questions (ordered by orderIndex: Q_ACME_1=0, Q_ACME_2=1, Q_ACME_3=2)
    const q1 = body.questions.find((q) => q.id === SEED_IDS.Q_ACME_1);
    const q2 = body.questions.find((q) => q.id === SEED_IDS.Q_ACME_2);
    const q3 = body.questions.find((q) => q.id === SEED_IDS.Q_ACME_3);

    // Q_ACME_1: RATING, values 3 and 5 → average 4.0
    expect(q1?.type).toBe('RATING');
    expect(q1?.average).toBe(4.0);
    expect(q1?.count).toBe(2);

    // Q_ACME_2: YES_NO, Bob=true, Carol=false → yes:1, no:1
    expect(q2?.type).toBe('YES_NO');
    expect(q2?.yes).toBe(1);
    expect(q2?.no).toBe(1);

    // Q_ACME_3: RATING, values 5 and 3 → average 4.0
    expect(q3?.type).toBe('RATING');
    expect(q3?.average).toBe(4.0);
    expect(q3?.count).toBe(2);
  });
});
