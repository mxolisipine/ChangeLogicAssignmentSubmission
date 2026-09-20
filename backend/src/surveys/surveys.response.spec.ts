import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { currentISOWeek } from '../common/iso-week';
import { Question, QuestionType } from '../entities/question.entity';
import { ResponseAnswer } from '../entities/response-answer.entity';
import { Response } from '../entities/response.entity';
import { Survey } from '../entities/survey.entity';
import type { SubmitResponseDto } from './dto/submit-response.dto';
import { SurveysService } from './surveys.service';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_B = 'aaaaaaaa-0000-0000-0000-000000000002';
const SURVEY_ID = 'cccccccc-0000-0000-0000-000000000001';
const USER_ID = 'bbbbbbbb-0000-0000-0000-000000000002';

const Q_RATING: Question = {
  id: 'dddddddd-0000-0000-0000-000000000001',
  surveyId: SURVEY_ID,
  text: 'How energised?',
  type: QuestionType.RATING,
  orderIndex: 0,
  survey: null as never,
  answers: [],
};

const Q_YESNO: Question = {
  id: 'dddddddd-0000-0000-0000-000000000002',
  surveyId: SURVEY_ID,
  text: '1:1 this week?',
  type: QuestionType.YES_NO,
  orderIndex: 1,
  survey: null as never,
  answers: [],
};

const SURVEY: Survey = {
  id: SURVEY_ID,
  organizationId: ORG_A,
  title: 'Acme Weekly Pulse',
  createdAt: new Date('2026-09-20T10:00:00Z'),
  organization: null as never,
  questions: [Q_RATING, Q_YESNO],
  responses: [],
};

const VALID_DTO: SubmitResponseDto = {
  answers: [
    { questionId: Q_RATING.id, ratingValue: 4 },
    { questionId: Q_YESNO.id, yesNoValue: true },
  ],
};

const SAVED_RESPONSE: Response = {
  id: 'eeeeeeee-0000-0000-0000-000000000001',
  surveyId: SURVEY_ID,
  userId: USER_ID,
  weekKey: currentISOWeek(),
  createdAt: new Date(),
  survey: null as never,
  user: null as never,
  answers: [],
};

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('SurveysService — submitResponse', () => {
  let service: SurveysService;

  const surveyRepo = { findOne: jest.fn() };
  const questionRepo = {};
  const responseRepo = { findOne: jest.fn() };

  // Minimal transaction mock: runs the callback with a mock entity manager
  const mockManager = {
    create: jest.fn((entity: unknown, data: unknown) => data),
    save: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn((cb: (manager: typeof mockManager) => Promise<unknown>) =>
      cb(mockManager),
    ),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        SurveysService,
        { provide: getRepositoryToken(Survey), useValue: surveyRepo },
        { provide: getRepositoryToken(Question), useValue: questionRepo },
        { provide: getRepositoryToken(Response), useValue: responseRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(SurveysService);
    jest.clearAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('returns 201 result with weekKey on a valid first submission', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    responseRepo.findOne.mockResolvedValue(null); // no prior submission
    mockManager.save
      .mockResolvedValueOnce(SAVED_RESPONSE)  // save Response
      .mockResolvedValueOnce([]);              // save ResponseAnswer[]

    const result = await service.submitResponse(SURVEY_ID, ORG_A, USER_ID, VALID_DTO);

    expect(result.id).toBe(SAVED_RESPONSE.id);
    expect(result.weekKey).toBe(SAVED_RESPONSE.weekKey);
    expect(result.surveyId).toBe(SURVEY_ID);
    expect(result.userId).toBe(USER_ID);
  });

  it('computes weekKey server-side and stores it on the response row', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    responseRepo.findOne.mockResolvedValue(null);
    mockManager.save
      .mockResolvedValueOnce(SAVED_RESPONSE)
      .mockResolvedValueOnce([]);

    await service.submitResponse(SURVEY_ID, ORG_A, USER_ID, VALID_DTO);

    const createCall = mockManager.create.mock.calls[0] as [unknown, { weekKey: string }];
    expect(createCall[1].weekKey).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('persists one ResponseAnswer per question inside the transaction', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    responseRepo.findOne.mockResolvedValue(null);
    mockManager.save
      .mockResolvedValueOnce(SAVED_RESPONSE)
      .mockResolvedValueOnce([]);

    await service.submitResponse(SURVEY_ID, ORG_A, USER_ID, VALID_DTO);

    // Second save call is for the answers array
    const answersSaveCall = mockManager.save.mock.calls[1] as [unknown, unknown[]];
    expect(Array.isArray(answersSaveCall[1])).toBe(true);
    expect(answersSaveCall[1]).toHaveLength(VALID_DTO.answers.length);
  });

  // ── 404 — cross-org isolation ──────────────────────────────────────────────

  it('throws 404 when the survey belongs to a different org (cross-org submission blocked)', async () => {
    // Survey exists in ORG_A; caller is ORG_B → repo returns null (where clause includes orgId)
    surveyRepo.findOne.mockResolvedValue(null);

    await expect(
      service.submitResponse(SURVEY_ID, ORG_B, USER_ID, VALID_DTO),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws 404 (not 403) on cross-org access to avoid leaking existence', async () => {
    surveyRepo.findOne.mockResolvedValue(null);

    const err = await service
      .submitResponse(SURVEY_ID, ORG_B, USER_ID, VALID_DTO)
      .catch((e) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.getStatus()).toBe(404);
  });

  // ── 409 — duplicate submission ────────────────────────────────────────────

  it('throws 409 when the member has already submitted this week (service-layer check)', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    responseRepo.findOne.mockResolvedValue({ id: 'existing-id' }); // already submitted

    await expect(
      service.submitResponse(SURVEY_ID, ORG_A, USER_ID, VALID_DTO),
    ).rejects.toThrow(ConflictException);
  });

  it('throws 409 with the correct message on duplicate submission', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    responseRepo.findOne.mockResolvedValue({ id: 'existing-id' });

    const err = await service
      .submitResponse(SURVEY_ID, ORG_A, USER_ID, VALID_DTO)
      .catch((e) => e);

    expect(err.message).toMatch(/already submitted/i);
  });

  it('throws 409 when the DB unique constraint fires (pg error code 23505)', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    responseRepo.findOne.mockResolvedValue(null);
    // Simulate transaction throwing a pg unique violation
    dataSource.transaction.mockRejectedValueOnce({ code: '23505' });

    await expect(
      service.submitResponse(SURVEY_ID, ORG_A, USER_ID, VALID_DTO),
    ).rejects.toThrow(ConflictException);
  });

  // ── 422 — answer validation ───────────────────────────────────────────────

  it('throws 422 when an answer references a questionId not in the survey', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    responseRepo.findOne.mockResolvedValue(null);

    const dto: SubmitResponseDto = {
      answers: [
        { questionId: 'unknown-question-id', ratingValue: 3 },
        { questionId: Q_YESNO.id, yesNoValue: false },
      ],
    };

    await expect(
      service.submitResponse(SURVEY_ID, ORG_A, USER_ID, dto),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('throws 422 when a survey question has no corresponding answer', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    responseRepo.findOne.mockResolvedValue(null);

    // Only answering one of the two required questions
    const dto: SubmitResponseDto = {
      answers: [{ questionId: Q_RATING.id, ratingValue: 3 }],
    };

    await expect(
      service.submitResponse(SURVEY_ID, ORG_A, USER_ID, dto),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('throws 422 when a RATING question receives yesNoValue instead of ratingValue', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    responseRepo.findOne.mockResolvedValue(null);

    const dto: SubmitResponseDto = {
      answers: [
        { questionId: Q_RATING.id, yesNoValue: true }, // wrong type for RATING
        { questionId: Q_YESNO.id, yesNoValue: false },
      ],
    };

    await expect(
      service.submitResponse(SURVEY_ID, ORG_A, USER_ID, dto),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('throws 422 when a YES_NO question receives ratingValue instead of yesNoValue', async () => {
    surveyRepo.findOne.mockResolvedValue(SURVEY);
    responseRepo.findOne.mockResolvedValue(null);

    const dto: SubmitResponseDto = {
      answers: [
        { questionId: Q_RATING.id, ratingValue: 4 },
        { questionId: Q_YESNO.id, ratingValue: 2 }, // wrong type for YES_NO
      ],
    };

    await expect(
      service.submitResponse(SURVEY_ID, ORG_A, USER_ID, dto),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});

// ─── ISO week helper tests ────────────────────────────────────────────────────

describe('currentISOWeek', () => {
  it('returns a string matching YYYY-Www format', () => {
    expect(currentISOWeek()).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('returns 2026-W38 for 2026-09-20 (a Sunday in W38)', () => {
    expect(currentISOWeek(new Date('2026-09-20'))).toBe('2026-W38');
  });

  it('returns 2026-W38 for 2026-09-14 (the Monday that opens W38)', () => {
    expect(currentISOWeek(new Date('2026-09-14'))).toBe('2026-W38');
  });

  it('returns 2026-W37 for 2026-09-13 (the Sunday that closes W37)', () => {
    expect(currentISOWeek(new Date('2026-09-13'))).toBe('2026-W37');
  });
});
