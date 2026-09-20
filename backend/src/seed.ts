/**
 * Seed script — inserts demo data for two organizations.
 *
 * Run with:  npm run seed
 *
 * All UUIDs are hardcoded so tests can reference them directly.
 * The script is idempotent: every INSERT uses ON CONFLICT DO NOTHING.
 */

import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { currentISOWeek } from './common/iso-week';

// ─── Hardcoded UUIDs ────────────────────────────────────────────────────────

export const SEED_IDS = {
  // Organizations
  ORG_ACME:   'aaaaaaaa-0000-0000-0000-000000000001',
  ORG_GLOBEX: 'aaaaaaaa-0000-0000-0000-000000000002',

  // Users — Acme
  USER_ALICE: 'bbbbbbbb-0000-0000-0000-000000000001', // MANAGER
  USER_BOB:   'bbbbbbbb-0000-0000-0000-000000000002', // MEMBER
  USER_CAROL: 'bbbbbbbb-0000-0000-0000-000000000003', // MEMBER

  // Users — Globex
  USER_DAVE:  'bbbbbbbb-0000-0000-0000-000000000004', // MANAGER
  USER_EVE:   'bbbbbbbb-0000-0000-0000-000000000005', // MEMBER
  USER_FRANK: 'bbbbbbbb-0000-0000-0000-000000000006', // MEMBER

  // Surveys
  SURVEY_ACME:   'cccccccc-0000-0000-0000-000000000001',
  SURVEY_GLOBEX: 'cccccccc-0000-0000-0000-000000000002',

  // Questions — Acme survey
  Q_ACME_1: 'dddddddd-0000-0000-0000-000000000001', // RATING
  Q_ACME_2: 'dddddddd-0000-0000-0000-000000000002', // YES_NO
  Q_ACME_3: 'dddddddd-0000-0000-0000-000000000003', // RATING

  // Questions — Globex survey
  Q_GLOBEX_1: 'dddddddd-0000-0000-0000-000000000004', // YES_NO
  Q_GLOBEX_2: 'dddddddd-0000-0000-0000-000000000005', // RATING
} as const;

// ─── Main ────────────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  await AppDataSource.initialize();
  const runner = AppDataSource.createQueryRunner();

  try {
    await runner.connect();
    await runner.startTransaction();

    // 1. Organizations
    await runner.query(`
      INSERT INTO organizations (id, name)
      VALUES
        ($1, 'Acme'),
        ($2, 'Globex')
      ON CONFLICT (id) DO NOTHING
    `, [SEED_IDS.ORG_ACME, SEED_IDS.ORG_GLOBEX]);

    // 2. Users
    await runner.query(`
      INSERT INTO users (id, organization_id, name, email, role)
      VALUES
        ($1,  $7,  'Alice', 'alice@acme.example',   'MANAGER'),
        ($2,  $7,  'Bob',   'bob@acme.example',     'MEMBER'),
        ($3,  $7,  'Carol', 'carol@acme.example',   'MEMBER'),
        ($4,  $8,  'Dave',  'dave@globex.example',  'MANAGER'),
        ($5,  $8,  'Eve',   'eve@globex.example',   'MEMBER'),
        ($6,  $8,  'Frank', 'frank@globex.example', 'MEMBER')
      ON CONFLICT (id) DO NOTHING
    `, [
      SEED_IDS.USER_ALICE,
      SEED_IDS.USER_BOB,
      SEED_IDS.USER_CAROL,
      SEED_IDS.USER_DAVE,
      SEED_IDS.USER_EVE,
      SEED_IDS.USER_FRANK,
      SEED_IDS.ORG_ACME,
      SEED_IDS.ORG_GLOBEX,
    ]);

    // 3. Surveys — one per org, titled for the current ISO week
    const weekKey = currentISOWeek();
    await runner.query(`
      INSERT INTO surveys (id, organization_id, title)
      VALUES
        ($1, $3, $5),
        ($2, $4, $6)
      ON CONFLICT (id) DO NOTHING
    `, [
      SEED_IDS.SURVEY_ACME,
      SEED_IDS.SURVEY_GLOBEX,
      SEED_IDS.ORG_ACME,
      SEED_IDS.ORG_GLOBEX,
      `Acme Weekly Pulse — ${weekKey}`,
      `Globex Weekly Pulse — ${weekKey}`,
    ]);

    // 4. Questions — Acme survey (3 questions: RATING, YES_NO, RATING)
    await runner.query(`
      INSERT INTO questions (id, survey_id, text, type, order_index)
      VALUES
        ($1, $6, 'How energised do you feel this week? (1 = exhausted, 5 = great)', 'RATING',  0),
        ($2, $6, 'Did you have a 1:1 with your manager this week?',                 'YES_NO',  1),
        ($3, $6, 'How well did your team collaborate this week? (1 = poor, 5 = excellent)', 'RATING', 2),
        ($4, $7, 'Did you feel your work was impactful this week?',                 'YES_NO',  0),
        ($5, $7, 'How clear were your priorities this week? (1 = unclear, 5 = very clear)', 'RATING', 1)
      ON CONFLICT (id) DO NOTHING
    `, [
      SEED_IDS.Q_ACME_1,
      SEED_IDS.Q_ACME_2,
      SEED_IDS.Q_ACME_3,
      SEED_IDS.Q_GLOBEX_1,
      SEED_IDS.Q_GLOBEX_2,
      SEED_IDS.SURVEY_ACME,
      SEED_IDS.SURVEY_GLOBEX,
    ]);

    await runner.commitTransaction();
    console.log(`✓ Seed complete. Surveys tagged with week key: ${weekKey}`);
    console.log('  Organizations:', SEED_IDS.ORG_ACME, '(Acme)', SEED_IDS.ORG_GLOBEX, '(Globex)');
    console.log('  Users seeded: Alice, Bob, Carol (Acme) | Dave, Eve, Frank (Globex)');
  } catch (err) {
    await runner.rollbackTransaction();
    console.error('✗ Seed failed — transaction rolled back:', err);
    process.exit(1);
  } finally {
    await runner.release();
    await AppDataSource.destroy();
  }
}

seed();
