import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from './entities/organization.entity';
import { User } from './entities/user.entity';
import { Survey } from './entities/survey.entity';
import { Question } from './entities/question.entity';
import { Response } from './entities/response.entity';
import { ResponseAnswer } from './entities/response-answer.entity';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { SurveysModule } from './surveys/surveys.module';

/**
 * Root application module.
 *
 * Guard order matters:
 *   1. AuthGuard — resolves identity (401 if missing/unknown X-User-Id).
 *   2. RolesGuard — checks role against @Roles() decorator (403 if wrong role).
 *
 * NestJS executes APP_GUARD providers in the order they are declared.
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env['DB_HOST'] ?? 'localhost',
      port: parseInt(process.env['DB_PORT'] ?? '5432', 10),
      username: process.env['DB_USER'] ?? 'pulse',
      password: process.env['DB_PASSWORD'] ?? 'pulse',
      database: process.env['DB_NAME'] ?? 'pulse',
      entities: [Organization, User, Survey, Question, Response, ResponseAnswer],
      synchronize: false,
      logging: process.env['NODE_ENV'] !== 'production',
    }),
    AuthModule,
    SurveysModule,
  ],
  providers: [
    // 1. Identity resolution — must run before RolesGuard.
    // useExisting references the AuthGuard instance already instantiated by
    // AuthModule, so its UserRepository dependency resolves correctly.
    {
      provide: APP_GUARD,
      useExisting: AuthGuard,
    },
    // 2. Role authorization — runs after AuthGuard populates request.user
    {
      provide: APP_GUARD,
      useExisting: RolesGuard,
    },
  ],
})
export class AppModule {}
