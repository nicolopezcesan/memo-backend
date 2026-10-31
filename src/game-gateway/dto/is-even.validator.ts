import {
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';

export function IsEven(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isEven',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'number' && value % 2 === 0;
        },
        defaultMessage() {
          return `${propertyName} must be an even number`;
        },
      },
    });
  };
}
