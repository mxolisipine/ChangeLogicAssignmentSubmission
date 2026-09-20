import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUserParam } from '../auth/current-user.decorator';
import type { CurrentUser } from '../auth/current-user.interface';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../entities/user.entity';
import { CreateSurveyDto } from './dto/create-survey.dto';
import { SurveysService } from './surveys.service';

/**
 * SurveysController — thin HTTP layer.
 * All business logic lives in SurveysService.
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
   * Must be declared before /:id to avoid being shadowed by the param route.
   */
  @Get('active')
  getActiveSurvey(@CurrentUserParam() currentUser: CurrentUser) {
    return this.surveysService.getActiveSurvey(currentUser.organizationId);
  }

  /**
   * GET /surveys/:id
   * MANAGER or MEMBER. Returns 404 if the survey belongs to a different org.
   */
  @Get(':id')
  getSurveyById(
    @Param('id') id: string,
    @CurrentUserParam() currentUser: CurrentUser,
  ) {
    return this.surveysService.getSurveyById(id, currentUser.organizationId);
  }
}
