import { IsInt, Min } from 'class-validator';

export class CardFlipDto {
  @IsInt()
  @Min(0)
  cardIndex!: number;
}
