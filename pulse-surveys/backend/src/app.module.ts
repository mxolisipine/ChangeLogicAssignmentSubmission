import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

/**
 * Root application module.
 *
 * TypeORM is configured here with synchronize: true for local development only.
 * Feature modules (AuthModule, SurveysModule, OrganizationsModule) will be
 * imported here once implemented.
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
      // Entities will be added here as feature modules are built
      entities: [],
      // Auto-create schema in development — will be replaced with migrations
      synchronize: process.env['NODE_ENV'] !== 'production',
      logging: process.env['NODE_ENV'] !== 'production',
    }),
  ],
})
export class AppModule {}
