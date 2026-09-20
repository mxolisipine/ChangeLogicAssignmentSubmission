import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Organization } from './entities/organization.entity';
import { User } from './entities/user.entity';
import { Survey } from './entities/survey.entity';
import { Question } from './entities/question.entity';
import { Response } from './entities/response.entity';
import { ResponseAnswer } from './entities/response-answer.entity';

/**
 * Standalone DataSource used by the TypeORM CLI (migrations:run, migrations:generate, etc.).
 * The NestJS AppModule uses its own TypeOrmModule.forRoot() configuration.
 * Both point at the same database and entity list.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env['DB_HOST'] ?? 'localhost',
  port: parseInt(process.env['DB_PORT'] ?? '5432', 10),
  username: process.env['DB_USER'] ?? 'pulse',
  password: process.env['DB_PASSWORD'] ?? 'pulse',
  database: process.env['DB_NAME'] ?? 'pulse',
  entities: [Organization, User, Survey, Question, Response, ResponseAnswer],
  migrations: ['src/migrations/*.ts'],
  // synchronize must be false when using migrations
  synchronize: false,
  logging: true,
});
