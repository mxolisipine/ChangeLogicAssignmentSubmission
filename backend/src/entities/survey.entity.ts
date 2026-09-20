import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from './organization.entity';
import { Question } from './question.entity';
import { Response } from './response.entity';

@Entity('surveys')
@Index(['organizationId'])
export class Survey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Organization, (org) => org.surveys, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organizationId' })
  organization!: Organization;

  @OneToMany(() => Question, (question) => question.survey, { cascade: true })
  questions!: Question[];

  @OneToMany(() => Response, (response) => response.survey)
  responses!: Response[];
}
