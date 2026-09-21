import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class SubmitAnswerDto {
  /** The question's UUID. Ownership verified by the service layer. */
  @IsString()
  @IsNotEmpty()
  questionId!: string;

  /**
   * Required for RATING questions (1–5). Must be absent for YES_NO questions.
   * Cross-type validation (wrong field for question type) is performed in the
   * service layer where the question type is known.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  ratingValue?: number;

  /**
   * Required for YES_NO questions. Must be absent for RATING questions.
   */
  @IsOptional()
  @IsBoolean()
  yesNoValue?: boolean;
}

export class SubmitResponseDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SubmitAnswerDto)
  answers!: SubmitAnswerDto[];
}
