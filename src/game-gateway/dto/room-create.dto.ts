import { Transform } from 'class-transformer';
import { IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';
import { IsEven } from './is-even.validator.js';

export class RoomCreateDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 20)
  @Matches(/^[a-zA-Z0-9 -]+$/)
  nickname!: string;

  @IsInt()
  @Min(4)
  @Max(36)
  @IsEven()
  boardSize!: number;
}
