import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Survey } from './survey.entity';
import { ResponseAnswer } from './response-answer.entity';

export enum QuestionType {
  RATING = 'RATING',
  YES_NO = 'YES_NO',
}

@Entity('questions')
@Index(['surveyId', 'orderIndex'])
export class Question {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'survey_id' })
  surveyId!: string;

  @Column({ type: 'varchar', length: 1000 })
  text!: string;

  @Column({ type: 'enum', enum: QuestionType })
  type!: QuestionType;

  /**
   * Zero-based display order within the survey (0, 1, 2).
   * Max 3 questions per survey is enforced at the service layer, not here.
   */
  @Column({ type: 'smallint', name: 'order_index' })
  orderIndex!: number;

  @ManyToOne(() => Survey, (survey) => survey.questions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'survey_id' })
  survey!: Survey;

  @OneToMany(() => ResponseAnswer, (answer) => answer.question)
  answers!: ResponseAnswer[];
}
