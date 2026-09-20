import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { currentISOWeek } from '../common/iso-week';
import { Question, QuestionType } from '../entities/question.entity';
import { ResponseAnswer } from '../entities/response-answer.entity';
import { Response } from '../entities/response.entity';
import { Survey } from '../entities/survey.entity';
import type { CreateSurveyDto } from './dto/create-survey.dto';
import type { SubmitResponseDto } from './dto/submit-response.dto';

/** Shape returned after a successful response submission */
export interface SubmitResponseResult {
  id: string;
  surveyId: string;
  userId: string;
  weekKey: string;
  createdAt: Date;
}

/** Per-question rollup inside the summary response */
export type QuestionSummary =
  | { id: string; text: string; type: 'RATING'; average: number | null; count: number }
  | { id: string; text: string; type: 'YES_NO'; yes: number; no: number };

/** Shape returned by GET /surveys/:id/summary */
export interface SurveySummary {
  surveyId: string;
  week: string;
  completion: {
    count: number;
    totalMembers: number;
    rate: number;
  };
  questions: QuestionSummary[];
}

/**
 * SurveysService — all business logic for survey creation, retrieval,
 * and response submission.
 *
 * Every method that touches org-owned data accepts organizationId explicitly.
 * The value always comes from currentUser.organizationId in the controller.
 */
@Injectable()
export class SurveysService {
  constructor(
    @InjectRepository(Survey)
    private readonly surveyRepository: Repository<Survey>,
    @InjectRepository(Response)
    private readonly responseRepository: Repository<Response>,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Survey creation ───────────────────────────────────────────────────────

  /**
   * Create a survey with its questions for the given organization.
   * orderIndex is assigned server-side (0-based, matching the array order).
   * organizationId comes exclusively from the caller — never from the DTO.
   */
  async createSurvey(dto: CreateSurveyDto, organizationId: string): Promise<Survey> {
    const survey = this.surveyRepository.create({
      title: dto.title,
      organizationId,
      questions: dto.questions.map((q, index) => ({
        text: q.text,
        type: q.type,
        orderIndex: index,
      })),
    });

    return this.surveyRepository.save(survey);
  }

  // ─── Survey retrieval ──────────────────────────────────────────────────────

  /**
   * Return the most recently created survey for the organization.
   * "Active" is not a status flag — the newest survey is always returned.
   */
  async getActiveSurvey(organizationId: string): Promise<Survey> {
    const survey = await this.surveyRepository.findOne({
      where: { organizationId },
      relations: { questions: true },
      order: { createdAt: 'DESC' },
    });

    if (!survey) {
      throw new NotFoundException('No active survey found for your organization');
    }

    survey.questions.sort((a, b) => a.orderIndex - b.orderIndex);
    return survey;
  }

  /**
   * Return a survey by id, scoped to organizationId.
   * Returns 404 on cross-org access to avoid leaking resource existence.
   */
  async getSurveyById(id: string, organizationId: string): Promise<Survey> {
    const survey = await this.surveyRepository.findOne({
      where: { id, organizationId },
      relations: { questions: true },
    });

    if (!survey) {
      throw new NotFoundException('Survey not found');
    }

    survey.questions.sort((a, b) => a.orderIndex - b.orderIndex);
    return survey;
  }

  // ─── Response submission ───────────────────────────────────────────────────

  /**
   * Submit a response for a survey.
   *
   * Validation order (fail-fast, cheapest checks first):
   *   1. Survey exists and belongs to caller's org (404 if not).
   *   2. All survey questions are answered — no extras, no missing (422).
   *   3. Each answer's questionId belongs to the survey (422).
   *   4. Each answer value matches the question's type (422).
   *   5. Duplicate submission check: existing row for (survey, user, week) → 409.
   *   6. Insert response + answers in a transaction.
   *      DB UNIQUE constraint is the final safety net; catch it → 409.
   */
  async submitResponse(
    surveyId: string,
    organizationId: string,
    userId: string,
    dto: SubmitResponseDto,
  ): Promise<SubmitResponseResult> {
    // ── 1. Load survey with questions, scoped to org ──────────────────────
    const survey = await this.surveyRepository.findOne({
      where: { id: surveyId, organizationId },
      relations: { questions: true },
    });

    if (!survey) {
      throw new NotFoundException('Survey not found');
    }

    const questions = survey.questions;
    const questionMap = new Map(questions.map((q) => [q.id, q]));

    // ── 2 & 3. Check every survey question is answered, no extras ────────
    const answeredIds = new Set(dto.answers.map((a) => a.questionId));

    // Extra answers for questions not in this survey
    for (const a of dto.answers) {
      if (!questionMap.has(a.questionId)) {
        throw new UnprocessableEntityException(
          `Question ${a.questionId} does not belong to this survey`,
        );
      }
    }

    // Missing answers for survey questions
    for (const q of questions) {
      if (!answeredIds.has(q.id)) {
        throw new UnprocessableEntityException(
          `Missing answer for question ${q.id}`,
        );
      }
    }

    // Duplicate answer for the same question
    if (answeredIds.size !== dto.answers.length) {
      throw new UnprocessableEntityException('Duplicate answers for the same question');
    }

    // ── 4. Type validation for each answer ────────────────────────────────
    for (const a of dto.answers) {
      const question = questionMap.get(a.questionId)!;
      this.validateAnswerType(question, a);
    }

    // ── 5. Service-layer duplicate check (returns clean 409 before DB) ────
    const weekKey = currentISOWeek();
    const existing = await this.responseRepository.findOne({
      where: { surveyId, userId, weekKey },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        'You have already submitted a response for this survey this week.',
      );
    }

    // ── 6. Persist in a transaction ───────────────────────────────────────
    try {
      return await this.dataSource.transaction(async (manager) => {
        const response = manager.create(Response, {
          surveyId,
          userId,
          weekKey,
        });
        const savedResponse = await manager.save(Response, response);

        const answerEntities = dto.answers.map((a) => {
          const question = questionMap.get(a.questionId)!;
          return manager.create(ResponseAnswer, {
            responseId: savedResponse.id,
            questionId: a.questionId,
            ratingValue: question.type === QuestionType.RATING ? (a.ratingValue ?? null) : null,
            yesNoValue: question.type === QuestionType.YES_NO ? (a.yesNoValue ?? null) : null,
          });
        });

        await manager.save(ResponseAnswer, answerEntities);

        return {
          id: savedResponse.id,
          surveyId: savedResponse.surveyId,
          userId: savedResponse.userId,
          weekKey: savedResponse.weekKey,
          createdAt: savedResponse.createdAt,
        };
      });
    } catch (err: unknown) {
      // Catch DB unique constraint violation on (survey_id, user_id, week_key)
      if (this.isUniqueViolation(err)) {
        throw new ConflictException(
          'You have already submitted a response for this survey this week.',
        );
      }
      throw err;
    }
  }

  // ─── Survey summary ────────────────────────────────────────────────────────

  /**
   * Aggregate completion and per-question rollups for a survey in a given week.
   *
   * All aggregation runs in PostgreSQL. Nothing is loaded into Node memory.
   *
   * Tenant isolation: the survey is first confirmed to belong to organizationId.
   * Returns 404 (not 403) on cross-org access to avoid leaking existence.
   *
   * totalMembers = COUNT of users with role MEMBER in the survey's org.
   * completionCount = COUNT of distinct response rows for (survey, week).
   * rate = completionCount / totalMembers, rounded to 4 dp (0 when totalMembers = 0).
   */
  async getSummary(
    surveyId: string,
    organizationId: string,
    weekParam?: string,
  ): Promise<SurveySummary> {
    const week = weekParam ?? currentISOWeek();

    // ── 1. Verify survey exists and belongs to this org ───────────────────
    const survey = await this.surveyRepository.findOne({
      where: { id: surveyId, organizationId },
    });

    if (!survey) {
      throw new NotFoundException('Survey not found');
    }

    // ── 2. Member count for this org (denominator) ────────────────────────
    const memberCountResult = await this.dataSource.query<[{ member_count: string }]>(
      `SELECT COUNT(*) AS member_count
       FROM users
       WHERE organization_id = $1
         AND role = 'MEMBER'`,
      [organizationId],
    );
    const totalMembers = parseInt(memberCountResult[0].member_count, 10);

    // ── 3. Completion count for (survey, week) ────────────────────────────
    const completionCountResult = await this.dataSource.query<[{ completion_count: string }]>(
      `SELECT COUNT(DISTINCT r.id) AS completion_count
       FROM responses r
       WHERE r.survey_id = $1
         AND r.week_key = $2`,
      [surveyId, week],
    );
    const completionCount = parseInt(completionCountResult[0].completion_count, 10);

    const rate =
      totalMembers === 0
        ? 0
        : Math.round((completionCount / totalMembers) * 10_000) / 10_000;

    // ── 4. Per-question rollup (one query, conditional aggregation) ───────
    // LEFT JOIN ensures questions with zero answers still appear in the result.
    // FILTER is standard PostgreSQL syntax — not ANSI SQL but TypeORM DataSource
    // passes raw SQL straight through.
    type RawRow = {
      question_id: string;
      question_text: string;
      question_type: string;
      order_index: string;
      answer_count: string;
      rating_average: string | null;
      yes_count: string;
      no_count: string;
    };

    const rows = await this.dataSource.query<RawRow[]>(
      `SELECT
         q.id                                                    AS question_id,
         q.text                                                  AS question_text,
         q.type                                                  AS question_type,
         q.order_index                                           AS order_index,
         COUNT(ra.id)                                            AS answer_count,
         AVG(ra.rating_value)                                    AS rating_average,
         COUNT(ra.id) FILTER (WHERE ra.yes_no_value = TRUE)      AS yes_count,
         COUNT(ra.id) FILTER (WHERE ra.yes_no_value = FALSE)     AS no_count
       FROM questions q
       LEFT JOIN response_answers ra ON ra.question_id = q.id
       LEFT JOIN responses r         ON r.id = ra.response_id
                                    AND r.week_key = $2
       WHERE q.survey_id = $1
       GROUP BY q.id, q.text, q.type, q.order_index
       ORDER BY q.order_index`,
      [surveyId, week],
    );

    // ── 5. Map raw rows to typed question summaries ───────────────────────
    const questions: QuestionSummary[] = rows.map((row) => {
      if (row.question_type === QuestionType.RATING) {
        const avg = row.rating_average !== null
          ? Math.round(parseFloat(row.rating_average) * 100) / 100
          : null;
        return {
          id: row.question_id,
          text: row.question_text,
          type: 'RATING' as const,
          average: avg,
          count: parseInt(row.answer_count, 10),
        };
      } else {
        return {
          id: row.question_id,
          text: row.question_text,
          type: 'YES_NO' as const,
          yes: parseInt(row.yes_count, 10),
          no: parseInt(row.no_count, 10),
        };
      }
    });

    return {
      surveyId,
      week,
      completion: { count: completionCount, totalMembers, rate },
      questions,
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private validateAnswerType(question: Question, answer: {
    questionId: string;
    ratingValue?: number;
    yesNoValue?: boolean;
  }): void {
    if (question.type === QuestionType.RATING) {
      if (answer.yesNoValue !== undefined && answer.yesNoValue !== null) {
        throw new UnprocessableEntityException(
          `Question ${question.id} is a RATING question — use ratingValue, not yesNoValue`,
        );
      }
      if (answer.ratingValue === undefined || answer.ratingValue === null) {
        throw new UnprocessableEntityException(
          `Question ${question.id} is a RATING question — ratingValue is required`,
        );
      }
    }

    if (question.type === QuestionType.YES_NO) {
      if (answer.ratingValue !== undefined && answer.ratingValue !== null) {
        throw new UnprocessableEntityException(
          `Question ${question.id} is a YES_NO question — use yesNoValue, not ratingValue`,
        );
      }
      if (answer.yesNoValue === undefined || answer.yesNoValue === null) {
        throw new UnprocessableEntityException(
          `Question ${question.id} is a YES_NO question — yesNoValue is required`,
        );
      }
    }
  }

  /**
   * Detect a PostgreSQL unique-constraint violation.
   * pg driver surfaces this as error code '23505'.
   */
  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    );
  }
}
