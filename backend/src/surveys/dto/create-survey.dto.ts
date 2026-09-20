import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { QuestionType } from '../../entities/question.entity';

export class CreateQuestionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  text!: string;

  @IsEnum(QuestionType, { message: 'type must be RATING or YES_NO' })
  type!: QuestionType;
}

export class CreateSurveyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'A survey must have at least one question' })
  @ArrayMaxSize(3, { message: 'A survey may have at most 3 questions' })
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionDto)
  questions!: CreateQuestionDto[];
}
