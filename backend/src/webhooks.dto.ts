import { IsObject, IsString, MinLength } from 'class-validator';

export class CreateWebhookDto {
  @IsString()
  @MinLength(1)
  eventId!: string;

  @IsString()
  @MinLength(1)
  type!: string;

  @IsObject()
  data!: Record<string, unknown>;
}
