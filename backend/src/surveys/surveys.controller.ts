import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUserParam } from '../auth/current-user.decorator';
import type { CurrentUser } from '../auth/current-user.interface';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../entities/user.entity';
import { CreateSurveyDto } from './dto/create-survey.dto';
import { SubmitResponseDto } from './dto/submit-response.dto';
import { SurveysService } from './surveys.service';

/**
 * SurveysController — thin HTTP layer.
 * All business logic lives in SurveysService.
 *
 * Route declaration order matters for NestJS/Express:
 *   GET /surveys/active  — must be declared before /:id
 *   GET /surveys/:id/summary — child route declared with full path; order fine
 *   GET /surveys/:id     — catch-all param, declared last
 */
@Controller('surveys')
export class SurveysController {
  constructor(private readonly surveysService: SurveysService) {}

  /**
   * POST /surveys
   * MANAGER only. organizationId is taken from currentUser — never from the body.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.MANAGER)
  createSurvey(
    @Body() dto: CreateSurveyDto,
    @CurrentUserParam() currentUser: CurrentUser,
  ) {
    return this.surveysService.createSurvey(dto, currentUser.organizationId);
  }

  /**
   * GET /surveys/active
   * MANAGER or MEMBER. Returns the most recently created survey for the caller's org.
   * Declared before /:id to avoid being matched by the param route.
   */
  @Get('active')
  getActiveSurvey(@CurrentUserParam() currentUser: CurrentUser) {
    return this.surveysService.getActiveSurvey(currentUser.organizationId);
  }

  /**
   * POST /surveys/:id/responses
   * MEMBER only. weekKey computed server-side; never read from the request.
   */
  @Post(':id/responses')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.MEMBER)
  submitResponse(
    @Param('id') surveyId: string,
    @Body() dto: SubmitResponseDto,
    @CurrentUserParam() currentUser: CurrentUser,
  ) {
    return this.surveysService.submitResponse(
      surveyId,
      currentUser.organizationId,
      currentUser.id,
      dto,
    );
  }

  /**
   * GET /surveys/:id/summary
   * MANAGER only. Returns aggregated completion and per-question rollups.
   * Optional ?week=YYYY-Www query param; defaults to the current ISO week.
   * Returns 404 if the survey does not belong to currentUser.organizationId.
   */
  @Get(':id/summary')
  @Roles(UserRole.MANAGER)
  getSummary(
    @Param('id') surveyId: string,
    @Query('week') week: string | undefined,
    @CurrentUserParam() currentUser: CurrentUser,
  ) {
    return this.surveysService.getSummary(
      surveyId,
      currentUser.organizationId,
      week,
    );
  }

  /**
   * GET /surveys/:id
   * MANAGER or MEMBER. Returns 404 if the survey belongs to a different org.
   * Declared after all more-specific routes to avoid shadowing them.
   */
  @Get(':id')
  getSurveyById(
    @Param('id') id: string,
    @CurrentUserParam() currentUser: CurrentUser,
  ) {
    return this.surveysService.getSurveyById(id, currentUser.organizationId);
  }
}
