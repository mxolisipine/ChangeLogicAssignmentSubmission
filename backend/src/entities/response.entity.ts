import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Survey } from './survey.entity';
import { User } from './user.entity';
import { ResponseAnswer } from './response-answer.entity';

@Entity('responses')
@Unique(['surveyId', 'userId', 'weekKey']) // enforces one submission per member per survey per ISO week
@Index(['surveyId', 'weekKey'])
export class Response {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'survey_id' })
  surveyId!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  /**
   * ISO 8601 week key, e.g. "2026-W38".
   * Computed server-side at submission time — never supplied by the client.
   */
  @Column({ type: 'varchar', length: 8, name: 'week_key' })
  weekKey!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => Survey, (survey) => survey.responses, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'survey_id' })
  survey!: Survey;

  @ManyToOne(() => User, (user) => user.responses, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @OneToMany(() => ResponseAnswer, (answer) => answer.response, {
    cascade: true,
  })
  answers!: ResponseAnswer[];
}
