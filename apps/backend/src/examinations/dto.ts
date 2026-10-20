import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { QuestionType } from '@prisma/client';

export class SaveAnswerDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  selectedIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  textAnswer?: string | null;
}

export class FlagDto {
  @IsBoolean()
  flagged!: boolean;
}

export class ActivityDto {
  @IsString()
  @MaxLength(80)
  eventType!: string;

  @IsOptional()
  detail?: Record<string, unknown>;
}

export class ExamOptionDto {
  @IsString()
  @MaxLength(500)
  text!: string;

  @IsBoolean()
  isCorrect!: boolean;
}

export class ExamQuestionDto {
  @IsString()
  @MaxLength(10000)
  prompt!: string;

  @IsEnum(QuestionType)
  type!: QuestionType;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  marks!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  negativeMarks?: number;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExamOptionDto)
  options!: ExamOptionDto[];
}

export class SaveExamDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MaxLength(10000)
  instructions!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes!: number;

  @IsDateString()
  opensAt!: string;

  @IsDateString()
  closesAt!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  maxMarks!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  passMarks!: number;

  @IsOptional()
  @IsBoolean()
  negativeMarking?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  negativeMarkValue?: number;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ExamQuestionDto)
  questions!: ExamQuestionDto[];
}

export class EvaluateAnswerDto {
  @IsString()
  questionId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  awardedMarks!: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  feedback?: string;
}

export class EvaluateAttemptDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EvaluateAnswerDto)
  answers!: EvaluateAnswerDto[];
}
