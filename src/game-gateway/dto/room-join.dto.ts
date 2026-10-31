import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export class RoomJoinDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Length(6, 6)
  roomCode!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 20)
  @Matches(/^[a-zA-Z0-9 -]+$/)
  nickname!: string;
}
