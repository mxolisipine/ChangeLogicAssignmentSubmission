import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Organization } from './entities/organization.entity';
import { User } from './entities/user.entity';
import { Survey } from './entities/survey.entity';
import { Question } from './entities/question.entity';
import { Response } from './entities/response.entity';
import { ResponseAnswer } from './entities/response-answer.entity';

/**
 * Root application module.
 *
 * TypeORM is configured here with synchronize: false — schema is managed
 * entirely by migrations (src/migrations/). Run `npm run migration:run`
 * before starting the server for the first time.
 *
 * Feature modules (AuthModule, SurveysModule) will be imported here once
 * implemented.
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
      // Schema is managed by migrations — never auto-sync in any environment
      synchronize: false,
      logging: process.env['NODE_ENV'] !== 'production',
    }),
  ],
})
export class AppModule {}
