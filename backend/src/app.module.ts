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

/**
 * Root application module.
 *
 * AuthGuard is registered as a global APP_GUARD so every route is protected
 * by default. Routes that should be public must be decorated with @Public().
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
  ],
  providers: [
    // Register AuthGuard globally — protects every route unless @Public()
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
