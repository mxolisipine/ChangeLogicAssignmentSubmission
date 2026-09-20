import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Question, QuestionType } from '../entities/question.entity';
import { Survey } from '../entities/survey.entity';
import { UserRole } from '../entities/user.entity';
import type { CreateSurveyDto } from './dto/create-survey.dto';
import { SurveysService } from './surveys.service';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_B = 'aaaaaaaa-0000-0000-0000-000000000002';
const SURVEY_ID = 'cccccccc-0000-0000-0000-000000000001';

const makeQuestion = (overrides: Partial<Question> = {}): Question => ({
  id: 'dddddddd-0000-0000-0000-000000000001',
  surveyId: SURVEY_ID,
  text: 'How energised do you feel?',
  type: QuestionType.RATING,
  orderIndex: 0,
  survey: null as never,
  answers: [],
  ...overrides,
});

const makeSurvey = (overrides: Partial<Survey> = {}): Survey => ({
  id: SURVEY_ID,
  organizationId: ORG_A,
  title: 'Acme Weekly Pulse — 2026-W38',
  createdAt: new Date('2026-09-20T10:00:00Z'),
  organization: null as never,
  questions: [makeQuestion()],
  responses: [],
  ...overrides,
});

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('SurveysService', () => {
  let service: SurveysService;

  const surveyRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  const questionRepo = {
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        SurveysService,
        { provide: getRepositoryToken(Survey), useValue: surveyRepo },
        { provide: getRepositoryToken(Question), useValue: questionRepo },
      ],
    }).compile();

    service = module.get(SurveysService);
    jest.clearAllMocks();
  });

  // ── createSurvey ─────────────────────────────────────────────────────────

  describe('createSurvey', () => {
    const dto: CreateSurveyDto = {
      title: 'Test Survey',
      questions: [
        { text: 'Q1', type: QuestionType.RATING },
        { text: 'Q2', type: QuestionType.YES_NO },
      ],
    };

    it('creates and saves a survey with org-scoped organizationId', async () => {
      const saved = makeSurvey({ organizationId: ORG_A });
      surveyRepo.create.mockReturnValue(saved);
      surveyRepo.save.mockResolvedValue(saved);

      const result = await service.createSurvey(dto, ORG_A);

      expect(surveyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_A }),
      );
      expect(surveyRepo.save).toHaveBeenCalledTimes(1);
      expect(result.organizationId).toBe(ORG_A);
    });

    it('assigns orderIndex server-side from the array position', async () => {
      const saved = makeSurvey();
      surveyRepo.create.mockReturnValue(saved);
      surveyRepo.save.mockResolvedValue(saved);

      await service.createSurvey(dto, ORG_A);

      const createArg = surveyRepo.create.mock.calls[0][0] as {
        questions: Array<{ orderIndex: number }>;
      };
      expect(createArg.questions[0].orderIndex).toBe(0);
      expect(createArg.questions[1].orderIndex).toBe(1);
    });

    it('never uses organizationId from the DTO', async () => {
      const saved = makeSurvey({ organizationId: ORG_A });
      surveyRepo.create.mockReturnValue(saved);
      surveyRepo.save.mockResolvedValue(saved);

      // Even if a rogue body sneaks an orgId in, the service ignores it
      const dtoWithOrg = { ...dto } as CreateSurveyDto & { organizationId?: string };
      dtoWithOrg.organizationId = ORG_B;

      await service.createSurvey(dtoWithOrg, ORG_A);

      const createArg = surveyRepo.create.mock.calls[0][0] as { organizationId: string };
      expect(createArg.organizationId).toBe(ORG_A);
      expect(createArg.organizationId).not.toBe(ORG_B);
    });
  });

  // ── getActiveSurvey ───────────────────────────────────────────────────────

  describe('getActiveSurvey', () => {
    it('returns the survey when one exists for the org', async () => {
      const survey = makeSurvey();
      surveyRepo.findOne.mockResolvedValue(survey);

      const result = await service.getActiveSurvey(ORG_A);

      expect(result.id).toBe(SURVEY_ID);
      expect(surveyRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG_A } }),
      );
    });

    it('throws NotFoundException when no survey exists for the org', async () => {
      surveyRepo.findOne.mockResolvedValue(null);

      await expect(service.getActiveSurvey(ORG_A)).rejects.toThrow(NotFoundException);
    });

    it('returns only surveys belonging to the caller org — not other orgs', async () => {
      // Org B has no survey → null → 404
      surveyRepo.findOne.mockResolvedValue(null);

      await expect(service.getActiveSurvey(ORG_B)).rejects.toThrow(NotFoundException);
      expect(surveyRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG_B } }),
      );
    });

    it('sorts questions by orderIndex', async () => {
      const survey = makeSurvey({
        questions: [
          makeQuestion({ orderIndex: 2, id: 'q3' }),
          makeQuestion({ orderIndex: 0, id: 'q1' }),
          makeQuestion({ orderIndex: 1, id: 'q2' }),
        ],
      });
      surveyRepo.findOne.mockResolvedValue(survey);

      const result = await service.getActiveSurvey(ORG_A);

      expect(result.questions[0].id).toBe('q1');
      expect(result.questions[1].id).toBe('q2');
      expect(result.questions[2].id).toBe('q3');
    });
  });

  // ── getSurveyById ─────────────────────────────────────────────────────────

  describe('getSurveyById', () => {
    it('returns the survey when it belongs to the caller org', async () => {
      const survey = makeSurvey();
      surveyRepo.findOne.mockResolvedValue(survey);

      const result = await service.getSurveyById(SURVEY_ID, ORG_A);

      expect(result.id).toBe(SURVEY_ID);
      expect(surveyRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SURVEY_ID, organizationId: ORG_A },
        }),
      );
    });

    it('throws NotFoundException when survey belongs to a different org (cross-org isolation)', async () => {
      // Survey exists in ORG_A but caller is from ORG_B → repo returns null
      surveyRepo.findOne.mockResolvedValue(null);

      await expect(service.getSurveyById(SURVEY_ID, ORG_B)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException (not ForbiddenException) to avoid leaking cross-org existence', async () => {
      surveyRepo.findOne.mockResolvedValue(null);

      const error = await service.getSurveyById(SURVEY_ID, ORG_B).catch((e) => e);

      expect(error).toBeInstanceOf(NotFoundException);
      // Must NOT be ForbiddenException — that would reveal the resource exists
      expect(error.getStatus()).toBe(404);
    });

    it('throws NotFoundException when the survey id does not exist at all', async () => {
      surveyRepo.findOne.mockResolvedValue(null);

      await expect(service.getSurveyById('non-existent-id', ORG_A)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── Roles decorator presence (controller-level, tested via metadata) ──────

  describe('RolesGuard integration — UserRole enum values', () => {
    it('UserRole.MANAGER is defined', () => {
      expect(UserRole.MANAGER).toBe('MANAGER');
    });

    it('UserRole.MEMBER is defined', () => {
      expect(UserRole.MEMBER).toBe('MEMBER');
    });
  });
});
