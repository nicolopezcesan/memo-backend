import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';

export type DtoValidationResult<T> =
  | { ok: true; dto: T }
  | { ok: false; message: string };

export async function validateDto<T extends object>(
  cls: ClassConstructor<T>,
  plain: unknown,
): Promise<DtoValidationResult<T>> {
  const dto = plainToInstance(cls, plain);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

  if (errors.length > 0) {
    const message = errors
      .flatMap((error) => Object.values(error.constraints ?? {}))
      .join(', ');
    return { ok: false, message };
  }

  return { ok: true, dto };
}
