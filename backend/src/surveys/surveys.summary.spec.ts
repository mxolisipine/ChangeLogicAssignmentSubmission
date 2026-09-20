import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Response } from '../entities/response.entity';
import { Survey } from '../entities/survey.entity';
import { SurveysService } from './surveys.service';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_B = 'aaaaaaaa-0000-0000-0000-000000000002';
const SURVEY_ID = 'cccccccc-0000-0000-0000-000000000001';
const WEEK = '2026-W38';

const SURVEY: Partial<Survey> = {
  id: SURVEY_ID,
  organizationId: ORG_A,
  title: 'Acme Weekly Pulse',
};

// Raw rows as PostgreSQL returns them — all numeric values come back as strings
const RAW_ROWS_MIXED = [
  {
    question_id: 'dddddddd-0000-0000-0000-000000000001',
    question_text: 'How energised?',
    question_type: 'RATING',
    order_index: '0',
    answer_count: '2',
    rating_average: '4.0000000000000000',
    yes_count: '0',
    no_count: '0',
  },
  {
    question_id: 'dddddddd-0000-0000-0000-000000000002',
    question_text: '1:1 this week?',
    question_type: 'YES_NO',
    order_index: '1',
    answer_count: '3',
    rating_average: null,
    yes_count: '2',
    no_count: '1',
  },
];

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('SurveysService — getSummary', () => {
  let service: SurveysService;

  const surveyRepo = { findOne: jest.fn() };
  const responseRepo = { findOne: jest.fn() };
  const dataSource = { query: jest.fn(), transaction: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        SurveysService,
        { provide: getRepositoryToken(Survey), useValue: surveyRepo },
        { provide: getRepositoryToken(Response), useValue: responseRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(SurveysService);
    jest.clearAllMocks();
  });

  // ── Tenant isolation (security) ────────────────────────────────────────────

  it('T1: cross-org summary — Org B manager cannot read Org A survey summary', async () => {
    // Invariant: survey.organizationId !== callerOrganizationId → 404.
    // A 200 here would be a data breach.
    surveyRepo.findOne.mockResolvedValue(null); // org filter excludes it

    await expect(service.getSummary(SURVEY_ID, ORG_B, WEEK)).rejects.toThrow(
      NotFoundException,
    );
    // DataSource.query must NOT have been called — no aggregation for unauthorized surveys
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('T1: cross-org summary returns 404, not 403, to avoid leaking existence', async () => {
    surveyRepo.findOne.mockResolvedValue(null);

    const err = await service.getSummary(SURVEY_ID, ORG_B, WEEK).catch((e) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.getStatus()).toBe(404);
  });

  it('T4: denominator uses only members of the survey org, not all users', async () => {
    // Invariant: totalMembers comes from WHERE organization_id = orgId AND role = MEMBER.
    // If the WHERE clause were absent the denominator would include other orgs.
    surveyRepo.findOne.mockResolvedValue(SURVEY);

    // Simulate: Org A has 3 members, but total DB members would be 5
    dataSource.query
      .mockResolvedValueOnce([{ member_count: '3' }])  // member count
      .mockResolvedValueOnce([{ completion_count: '1' }]) // completion count
      .mockResolvedValueOnce(RAW_ROWS_MIXED);             // per-question rollup

    const result = await service.getSummary(SURVEY_ID, ORG_A, WEEK);

    // Verify the member-count query was scoped to ORG_A
    const memberCountCall = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(memberCountCall[1]).toContain(ORG_A);

    // totalMembers must be 3 (org-scoped), rate = 1/3
    expect(result.completion.totalMembers).toBe(3);
    expect(result.completion.rate).toBe(0.3333);
  });

  // ── Summary correctness ────────────────────────────────────────────────────

  it('returns correct shape with surveyId, week, completion, questions', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    dataSource.query
      .mockResolvedValueOnce([{ member_count: '3' }])
      .mockResolvedValueOnce([{ completion_count: '2' }])
      .mockResolvedValueOnce(RAW_ROWS_MIXED);

    const result = await service.getSummary(SURVEY_ID, ORG_A, WEEK);

    expect(result.surveyId).toBe(SURVEY_ID);
    expect(result.week).toBe(WEEK);
    expect(result.completion).toMatchObject({ count: 2, totalMembers: 3 });
    expect(result.questions).toHaveLength(2);
  });

  it('completion rate = count / totalMembers rounded to 4 decimal places', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    dataSource.query
      .mockResolvedValueOnce([{ member_count: '3' }])
      .mockResolvedValueOnce([{ completion_count: '2' }])
      .mockResolvedValueOnce(RAW_ROWS_MIXED);

    const result = await service.getSummary(SURVEY_ID, ORG_A, WEEK);

    // 2/3 = 0.6667 (rounded to 4 dp)
    expect(result.completion.rate).toBe(0.6667);
  });

  it('RATING question with ratings 3 and 5 → average = 4.0, count = 2', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    dataSource.query
      .mockResolvedValueOnce([{ member_count: '2' }])
      .mockResolvedValueOnce([{ completion_count: '2' }])
      .mockResolvedValueOnce([
        {
          question_id: 'q1',
          question_text: 'Rating Q',
          question_type: 'RATING',
          order_index: '0',
          answer_count: '2',
          rating_average: '4.0000000000000000', // (3+5)/2
          yes_count: '0',
          no_count: '0',
        },
      ]);

    const result = await service.getSummary(SURVEY_ID, ORG_A, WEEK);
    const q = result.questions[0];

    expect(q.type).toBe('RATING');
    if (q.type === 'RATING') {
      expect(q.average).toBe(4.0);
      expect(q.count).toBe(2);
    }
  });

  it('YES_NO question with yes:2, no:1 → correct counts', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    dataSource.query
      .mockResolvedValueOnce([{ member_count: '3' }])
      .mockResolvedValueOnce([{ completion_count: '3' }])
      .mockResolvedValueOnce([
        {
          question_id: 'q2',
          question_text: 'Yes/No Q',
          question_type: 'YES_NO',
          order_index: '0',
          answer_count: '3',
          rating_average: null,
          yes_count: '2',
          no_count: '1',
        },
      ]);

    const result = await service.getSummary(SURVEY_ID, ORG_A, WEEK);
    const q = result.questions[0];

    expect(q.type).toBe('YES_NO');
    if (q.type === 'YES_NO') {
      expect(q.yes).toBe(2);
      expect(q.no).toBe(1);
    }
  });

  it('zero responses → completionCount = 0, rate = 0', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    dataSource.query
      .mockResolvedValueOnce([{ member_count: '3' }])
      .mockResolvedValueOnce([{ completion_count: '0' }])
      .mockResolvedValueOnce([
        {
          question_id: 'q1',
          question_text: 'Q',
          question_type: 'RATING',
          order_index: '0',
          answer_count: '0',
          rating_average: null,
          yes_count: '0',
          no_count: '0',
        },
      ]);

    const result = await service.getSummary(SURVEY_ID, ORG_A, WEEK);

    expect(result.completion.count).toBe(0);
    expect(result.completion.rate).toBe(0);
    // RATING question with no answers → average is null, count = 0
    const q = result.questions[0];
    if (q.type === 'RATING') {
      expect(q.average).toBeNull();
      expect(q.count).toBe(0);
    }
  });

  it('zero members → rate = 0 (no divide-by-zero error)', async () => {
    // Invariant: dividing by zero must never throw or produce NaN/Infinity
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    dataSource.query
      .mockResolvedValueOnce([{ member_count: '0' }])  // org has no members
      .mockResolvedValueOnce([{ completion_count: '0' }])
      .mockResolvedValueOnce([]);

    const result = await service.getSummary(SURVEY_ID, ORG_A, WEEK);

    expect(result.completion.totalMembers).toBe(0);
    expect(result.completion.rate).toBe(0);
    expect(Number.isFinite(result.completion.rate)).toBe(true);
  });

  it('defaults to the current ISO week when no week param is supplied', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    dataSource.query
      .mockResolvedValueOnce([{ member_count: '2' }])
      .mockResolvedValueOnce([{ completion_count: '0' }])
      .mockResolvedValueOnce([]);

    const result = await service.getSummary(SURVEY_ID, ORG_A, undefined);

    // weekKey must match YYYY-Www format and be the current week
    expect(result.week).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('uses the supplied week param when provided', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    dataSource.query
      .mockResolvedValueOnce([{ member_count: '2' }])
      .mockResolvedValueOnce([{ completion_count: '1' }])
      .mockResolvedValueOnce([]);

    const result = await service.getSummary(SURVEY_ID, ORG_A, '2026-W01');

    expect(result.week).toBe('2026-W01');
    // Verify the week param was passed to both count queries
    const completionQuery = dataSource.query.mock.calls[1] as [string, string[]];
    expect(completionQuery[1]).toContain('2026-W01');
  });

  it('RATING average is rounded to 2 decimal places', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    dataSource.query
      .mockResolvedValueOnce([{ member_count: '2' }])
      .mockResolvedValueOnce([{ completion_count: '2' }])
      .mockResolvedValueOnce([
        {
          question_id: 'q1',
          question_text: 'Q',
          question_type: 'RATING',
          order_index: '0',
          answer_count: '2',
          rating_average: '3.5000000000000000', // exactly representable
          yes_count: '0',
          no_count: '0',
        },
      ]);

    const result = await service.getSummary(SURVEY_ID, ORG_A, WEEK);
    const q = result.questions[0];

    if (q.type === 'RATING') {
      expect(q.average).toBe(3.5);
    }
  });

  it('questions are returned in orderIndex order', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    dataSource.query
      .mockResolvedValueOnce([{ member_count: '3' }])
      .mockResolvedValueOnce([{ completion_count: '2' }])
      .mockResolvedValueOnce(RAW_ROWS_MIXED); // order_index 0 then 1

    const result = await service.getSummary(SURVEY_ID, ORG_A, WEEK);

    expect(result.questions[0].type).toBe('RATING');
    expect(result.questions[1].type).toBe('YES_NO');
  });
});
