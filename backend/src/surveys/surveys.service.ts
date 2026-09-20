import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Question } from '../entities/question.entity';
import { Survey } from '../entities/survey.entity';
import type { CreateSurveyDto } from './dto/create-survey.dto';

/**
 * SurveysService — all business logic for survey creation and retrieval.
 *
 * Every method that touches surveys or questions accepts organizationId
 * explicitly and scopes every query to that org. The value always comes
 * from currentUser.organizationId in the controller.
 */
@Injectable()
export class SurveysService {
  constructor(
    @InjectRepository(Survey)
    private readonly surveyRepository: Repository<Survey>,
    @InjectRepository(Question)
    private readonly questionRepository: Repository<Question>,
  ) {}

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

    // cascade: true on Survey.questions persists questions in the same save
    return this.surveyRepository.save(survey);
  }

  /**
   * Return the most recently created survey for the organization, with
   * questions ordered by orderIndex.
   *
   * "Active" is not a status flag — every survey is considered active.
   * Returns the newest one (ORDER BY createdAt DESC LIMIT 1).
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

    // Sort questions by orderIndex for deterministic response ordering
    survey.questions.sort((a, b) => a.orderIndex - b.orderIndex);
    return survey;
  }

  /**
   * Return a survey by id, scoped to organizationId.
   * Returns 404 (not 403) when the survey belongs to a different org —
   * this avoids leaking the existence of surveys in other organizations.
   */
  async getSurveyById(id: string, organizationId: string): Promise<Survey> {
    const survey = await this.surveyRepository.findOne({
      where: { id, organizationId },
      relations: { questions: true },
    });

    if (!survey) {
      throw new NotFoundException(`Survey not found`);
    }

    survey.questions.sort((a, b) => a.orderIndex - b.orderIndex);
    return survey;
  }
}
