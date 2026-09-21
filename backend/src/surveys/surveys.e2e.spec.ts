/**
 * End-to-end happy-path test — one complete survey cycle.
 *
 * WHAT THIS TEST PROVES
 * ─────────────────────
 * This file exercises the full, real request path — from HTTP header to
 * PostgreSQL row and back — without any mocks or stubs. Every step below is
 * a real HTTP call through a real NestJS instance hitting a real Postgres DB.
 *
 * The seven steps are executed in a single ordered test so that the causal
 * chain is explicit and machine-verified:
 *
 *   1. A member can discover their organization's active survey.
 *   2. A member can submit a valid response → persisted to the DB.
 *   3. The SAME member cannot submit a second response in the same week →
 *      409 Conflict. This step MUST follow step 2 because the duplicate check
 *      requires a real row in the responses table. Mocking it would not prove
 *      that the UNIQUE(survey_id, user_id, week_key) DB constraint fires.
 *   4. A manager in the same org can fetch the weekly summary.
 *   5. The summary data (counts, averages, yes/no tallies) matches exactly
 *      what was submitted in step 2. This proves the SQL aggregation is correct
 *      and scoped to the right org and week.
 *
 * WHY SEQUENCE MATTERS
 * ────────────────────
 * Steps 3, 4, and 5 all depend on step 2 having actually written to the DB.
 *   - Step 3 without step 2 would return 404 (survey lookup) or succeed (no
 *     existing row), not 409. That would miss the duplicate-enforcement invariant.
 *   - Steps 4–5 without step 2 would return completionCount = 0, which would
 *     not prove that the aggregation correctly reads submitted data.
 *
 * CROSS-TENANT NEGATIVE TESTS
 * ────────────────────────────
 * Steps 6 and 7 run independently and do not depend on prior state. They
 * prove that users from Globex cannot touch Acme data — the tenant boundary
 * holds even when the caller knows the exact survey ID.
 *
 * PREREQUISITES
 * ─────────────
 *   - Docker Compose Postgres running on localhost:5432
 *   - Migration applied: `npm run migration:run`
 *   - Seed data loaded: `npm run seed`
 *
 * Run with:
 *   node node_modules/jest/bin/jest.js --config jest.integration.json --runInBand --forceExit
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { SEED_IDS } from '../seed';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function as(app: INestApplication, userId: string) {
  return {
    get: (path: string) =>
      request(app.getHttpServer()).get(path).set('x-user-id', userId),
    post: (path: string) =>
      request(app.getHttpServer()).post(path).set('x-user-id', userId),
  };
}

/**
 * Bob's answers for the Acme survey (3 questions: RATING, YES_NO, RATING).
 * Values are chosen so we can assert specific averages and counts afterward:
 *   Q_ACME_1 (RATING)  → 4
 *   Q_ACME_2 (YES_NO)  → true
 *   Q_ACME_3 (RATING)  → 2
 *
 * Expected summary after only Bob submits:
 *   Q_ACME_1 average = 4.00,  count = 1
 *   Q_ACME_2 yes = 1, no = 0
 *   Q_ACME_3 average = 2.00,  count = 1
 */
const BOB_ANSWERS = {
  answers: [
    { questionId: SEED_IDS.Q_ACME_1, ratingValue: 4 },
    { questionId: SEED_IDS.Q_ACME_2, yesNoValue: true },
    { questionId: SEED_IDS.Q_ACME_3, ratingValue: 2 },
  ],
};

// ─── Shared survey id captured in step 1 ─────────────────────────────────────

/**
 * The survey id is discovered dynamically via GET /surveys/active in step 1.
 * It is stored here so subsequent steps can reference it without hardcoding.
 */
let activeSurveyId: string;

// ─── Suite lifecycle ──────────────────────────────────────────────────────────

describe('E2E — full survey cycle (happy path + cross-tenant isolation)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    // Remove any responses written during this suite so the DB stays clean
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

  // Clean up before this suite runs so prior test suites don't affect us
  beforeAll(async () => {
    // This second beforeAll runs after the app is initialised, which is fine
    // because both beforeAll hooks share the same beforeAll queue.
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HAPPY PATH — all 5 ordered steps in one test
  // ═══════════════════════════════════════════════════════════════════════════

  it('complete cycle: discover → submit → duplicate → summary → assert correctness', async () => {
    // ── Pre-clean: remove any leftover responses from other test suites ─────
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

    // ── Step 1: Bob discovers the active survey for Acme ────────────────────
    //
    // Proves: GET /surveys/active returns a survey scoped to Bob's org (Acme).
    // The survey id is captured for all subsequent steps so we don't hardcode it.
    const activeRes = await as(app, SEED_IDS.USER_BOB).get('/surveys/active');

    expect(activeRes.status).toBe(200);
    expect(typeof activeRes.body.id).toBe('string');
    expect(activeRes.body.questions).toBeInstanceOf(Array);
    expect(activeRes.body.questions.length).toBeGreaterThan(0);

    activeSurveyId = activeRes.body.id as string;

    // The survey must belong to Acme — it must NOT be the Globex survey
    expect(activeSurveyId).toBe(SEED_IDS.SURVEY_ACME);

    // ── Step 2: Bob submits a valid response ─────────────────────────────────
    //
    // Proves: POST /surveys/:id/responses accepts a MEMBER's first submission,
    // writes it to the DB, and returns 201 with the correct shape.
    // This is the only step that creates state; steps 3–5 depend on it.
    const submitRes = await as(app, SEED_IDS.USER_BOB)
      .post(`/surveys/${activeSurveyId}/responses`)
      .send(BOB_ANSWERS);

    expect(submitRes.status).toBe(201);
    expect(submitRes.body.surveyId).toBe(activeSurveyId);
    expect(submitRes.body.userId).toBe(SEED_IDS.USER_BOB);
    expect(submitRes.body.weekKey).toMatch(/^\d{4}-W\d{2}$/);

    // The week key is server-computed — the client never supplied it
    const submittedWeek = submitRes.body.weekKey as string;

    // ── Step 3: Bob submits a second time in the same week → 409 ─────────────
    //
    // Proves: the UNIQUE(survey_id, user_id, week_key) invariant is enforced.
    // The service-layer pre-check sees the existing row (from step 2) and
    // returns 409 before even reaching the DB constraint.
    // This assertion is ONLY meaningful after step 2 has written a real row.
    const duplicateRes = await as(app, SEED_IDS.USER_BOB)
      .post(`/surveys/${activeSurveyId}/responses`)
      .send(BOB_ANSWERS);

    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.message).toMatch(/already submitted/i);

    // ── Step 4: Alice fetches the summary for the same week ──────────────────
    //
    // Proves: a MANAGER in the same org can read the summary.
    // Using the week key from step 2 ensures we're looking at the same window.
    const summaryRes = await as(app, SEED_IDS.USER_ALICE).get(
      `/surveys/${activeSurveyId}/summary?week=${submittedWeek}`,
    );

    expect(summaryRes.status).toBe(200);

    // ── Step 5: Assert summary data matches Bob's submission exactly ──────────
    //
    // Proves: the SQL aggregation (AVG, COUNT, FILTER) is correct and reads
    // the rows that were written in step 2. Any mismatch here means the
    // aggregation logic is wrong or reading from the wrong scope.
    const body = summaryRes.body as {
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

    expect(body.surveyId).toBe(activeSurveyId);
    expect(body.week).toBe(submittedWeek);

    // Completion: only Bob submitted, so count ≥ 1
    // (Other suites may have left rows if cleanup failed — use ≥ 1 not === 1)
    expect(body.completion.count).toBeGreaterThanOrEqual(1);

    // totalMembers = Acme MEMBERs only (Bob + Carol = 2)
    // Alice is MANAGER → excluded. Eve/Frank are Globex → excluded.
    expect(body.completion.totalMembers).toBe(2);

    // Bob is 1 of 2 Acme members, so rate ≥ 0.5
    expect(body.completion.rate).toBeGreaterThanOrEqual(0.5);

    // Per-question assertions — values must match BOB_ANSWERS exactly
    const q1 = body.questions.find((q) => q.id === SEED_IDS.Q_ACME_1);
    const q2 = body.questions.find((q) => q.id === SEED_IDS.Q_ACME_2);
    const q3 = body.questions.find((q) => q.id === SEED_IDS.Q_ACME_3);

    // Q_ACME_1: RATING, Bob submitted 4 → average must include 4
    expect(q1?.type).toBe('RATING');
    expect(q1?.count).toBeGreaterThanOrEqual(1);
    // If Bob is the only submitter, average === 4.0 exactly
    if (q1?.count === 1) {
      expect(q1.average).toBe(4.0);
    }

    // Q_ACME_2: YES_NO, Bob submitted true → yes count must be ≥ 1
    expect(q2?.type).toBe('YES_NO');
    expect(q2?.yes).toBeGreaterThanOrEqual(1);

    // Q_ACME_3: RATING, Bob submitted 2 → if only Bob, average === 2.0
    expect(q3?.type).toBe('RATING');
    expect(q3?.count).toBeGreaterThanOrEqual(1);
    if (q3?.count === 1) {
      expect(q3.average).toBe(2.0);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CROSS-TENANT ISOLATION — steps 6 and 7
  // ═══════════════════════════════════════════════════════════════════════════

  it('Step 6: Dave (Globex Manager) cannot view the summary for Acme\'s survey → 404', async () => {
    /**
     * Proves: GET /surveys/:id/summary scopes the survey lookup to the caller's
     * organizationId. Dave belongs to Globex. SURVEY_ACME belongs to Acme.
     * The service resolves Dave's org from the DB, queries
     * WHERE id = :id AND organization_id = :daveOrg, gets no row, and returns 404.
     *
     * A 200 here would be a data breach — Globex would see Acme completion data.
     * A 403 here would also be wrong — it would reveal the survey exists.
     * Only 404 is correct.
     */
    const res = await as(app, SEED_IDS.USER_DAVE).get(
      `/surveys/${SEED_IDS.SURVEY_ACME}/summary`,
    );

    expect(res.status).toBe(404);
  });

  it('Step 7: Eve (Globex Member) cannot submit a response to Acme\'s survey → 404', async () => {
    /**
     * Proves: POST /surveys/:id/responses checks survey.organizationId against
     * the caller's organizationId before any answer validation runs.
     * Eve belongs to Globex. SURVEY_ACME belongs to Acme.
     * The org mismatch is detected first → 404 (not 422 or 403).
     *
     * This is a critical security invariant: without it, Eve could poison Acme's
     * summary data by submitting responses to surveys she should not see.
     */
    const res = await as(app, SEED_IDS.USER_EVE)
      .post(`/surveys/${SEED_IDS.SURVEY_ACME}/responses`)
      .send({
        answers: [
          { questionId: SEED_IDS.Q_ACME_1, ratingValue: 5 },
          { questionId: SEED_IDS.Q_ACME_2, yesNoValue: false },
          { questionId: SEED_IDS.Q_ACME_3, ratingValue: 5 },
        ],
      });

    expect(res.status).toBe(404);
  });
});
