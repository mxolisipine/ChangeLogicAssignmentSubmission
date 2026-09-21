import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Response } from './response.entity';
import { Question } from './question.entity';

@Entity('response_answers')
@Unique(['responseId', 'questionId']) // one answer per question per response
@Check('"rating_value" IS NULL OR ("rating_value" >= 1 AND "rating_value" <= 5)')
@Check('NOT ("rating_value" IS NOT NULL AND "yes_no_value" IS NOT NULL)')
export class ResponseAnswer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'response_id' })
  responseId!: string;

  @Column({ type: 'uuid', name: 'question_id' })
  questionId!: string;

  /**
   * Populated when the question type is RATING (1–5).
   * Null for YES_NO questions.
   */
  @Column({ type: 'smallint', nullable: true, name: 'rating_value' })
  ratingValue!: number | null;

  /**
   * Populated when the question type is YES_NO.
   * Null for RATING questions.
   */
  @Column({ type: 'boolean', nullable: true, name: 'yes_no_value' })
  yesNoValue!: boolean | null;

  @ManyToOne(() => Response, (response) => response.answers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'response_id' })
  response!: Response;

  @ManyToOne(() => Question, (question) => question.answers, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'question_id' })
  question!: Question;
}
