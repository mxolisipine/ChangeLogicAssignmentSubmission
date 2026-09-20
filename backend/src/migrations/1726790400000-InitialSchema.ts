import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema migration — builds all six tables from scratch.
 *
 * Timestamp: 1726790400000  (2026-09-20T00:00:00.000Z, week 2026-W38)
 *
 * Tables created:
 *   organizations, users, surveys, questions, responses, response_answers
 *
 * Key constraints:
 *   - UNIQUE(survey_id, user_id, week_key) on responses
 *   - CHECK(rating_value BETWEEN 1 AND 5) on response_answers
 *   - CHECK(NOT both rating_value and yes_no_value set) on response_answers
 *   - UNIQUE(response_id, question_id) on response_answers
 */
export class InitialSchema1726790400000 implements MigrationInterface {
  name = 'InitialSchema1726790400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // 1. organizations
    // ------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "organizations" (
        "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
        "name"       VARCHAR(255) NOT NULL,
        "created_at" TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_organizations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_organizations_name" UNIQUE ("name")
      )
    `);

    // ------------------------------------------------------------------
    // 2. users
    // ------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TYPE "users_role_enum" AS ENUM ('MANAGER', 'MEMBER')
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"              UUID                 NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" UUID                 NOT NULL,
        "name"            VARCHAR(255)         NOT NULL,
        "email"           VARCHAR(255)         NOT NULL,
        "role"            "users_role_enum"    NOT NULL,
        "created_at"      TIMESTAMPTZ          NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "FK_users_organization"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id")
          ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_users_organization_id" ON "users" ("organization_id")
    `);

    // ------------------------------------------------------------------
    // 3. surveys
    // ------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "surveys" (
        "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" UUID         NOT NULL,
        "title"           VARCHAR(255) NOT NULL,
        "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_surveys" PRIMARY KEY ("id"),
        CONSTRAINT "FK_surveys_organization"
          FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id")
          ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_surveys_organization_id" ON "surveys" ("organization_id")
    `);

    // ------------------------------------------------------------------
    // 4. questions
    // ------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TYPE "questions_type_enum" AS ENUM ('RATING', 'YES_NO')
    `);

    await queryRunner.query(`
      CREATE TABLE "questions" (
        "id"          UUID                    NOT NULL DEFAULT gen_random_uuid(),
        "survey_id"   UUID                    NOT NULL,
        "text"        VARCHAR(1000)           NOT NULL,
        "type"        "questions_type_enum"   NOT NULL,
        "order_index" SMALLINT                NOT NULL,
        CONSTRAINT "PK_questions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_questions_survey"
          FOREIGN KEY ("survey_id")
          REFERENCES "surveys"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_questions_survey_order"
        ON "questions" ("survey_id", "order_index")
    `);

    // ------------------------------------------------------------------
    // 5. responses
    // ------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "responses" (
        "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
        "survey_id"  UUID         NOT NULL,
        "user_id"    UUID         NOT NULL,
        "week_key"   VARCHAR(8)   NOT NULL,
        "created_at" TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_responses" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_responses_survey_user_week"
          UNIQUE ("survey_id", "user_id", "week_key"),
        CONSTRAINT "FK_responses_survey"
          FOREIGN KEY ("survey_id")
          REFERENCES "surveys"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_responses_user"
          FOREIGN KEY ("user_id")
          REFERENCES "users"("id")
          ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_responses_survey_week"
        ON "responses" ("survey_id", "week_key")
    `);

    // ------------------------------------------------------------------
    // 6. response_answers
    // ------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "response_answers" (
        "id"           UUID      NOT NULL DEFAULT gen_random_uuid(),
        "response_id"  UUID      NOT NULL,
        "question_id"  UUID      NOT NULL,
        "rating_value" SMALLINT  NULL,
        "yes_no_value" BOOLEAN   NULL,
        CONSTRAINT "PK_response_answers" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_response_answers_response_question"
          UNIQUE ("response_id", "question_id"),
        CONSTRAINT "CHK_response_answers_rating_range"
          CHECK ("rating_value" IS NULL OR ("rating_value" >= 1 AND "rating_value" <= 5)),
        CONSTRAINT "CHK_response_answers_exclusive_value"
          CHECK (NOT ("rating_value" IS NOT NULL AND "yes_no_value" IS NOT NULL)),
        CONSTRAINT "FK_response_answers_response"
          FOREIGN KEY ("response_id")
          REFERENCES "responses"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_response_answers_question"
          FOREIGN KEY ("question_id")
          REFERENCES "questions"("id")
          ON DELETE RESTRICT
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "response_answers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "responses"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "questions"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "questions_type_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "surveys"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "users_role_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "organizations"`);
  }
}
