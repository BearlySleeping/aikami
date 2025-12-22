import { z } from 'zod'
import { FieldValueSchema, TimestampSchema } from './fields.ts'

// Code to transform error message to localized key for parameters
// const customErrorMap: z.ZodErrorMap = (issue, ctx) => {
//   const code = issue.code;
//   let message = ctx.defaultError;

//   if (code === z.ZodIssueCode.invalid_string) {
//     message = "validation_error_invalid";
//   }

//   if (code === z.ZodIssueCode.invalid_type) {
//     message = "validation_error_invalid";
//   }

//   if (code === z.ZodIssueCode.too_small) {
//     message = "validation_error_required";
//   }

//   if (message === "Required") {
//     message = "validation_error_required";
//   }

//   return { message };
// };

// z.setErrorMap(customErrorMap);

export const CoreFormSchema = z.object({
  id: z.string().optional(),
})

export const CoreSchema = z.object({
  /**
   * This is required, but if a document is just created with the server
   * timestamp, it will be undefined.
   */
  createdAt: TimestampSchema.optional().or(z.null()),
  id: z.string(),
  priority: z.number().optional(),
  updatedAt: TimestampSchema.optional().or(z.null()),
})

/**
 * The keys to omit when creating a new record.
 */
export const CoreOmitSchema = {
  id: true,
  createdAt: true,
  updatedAt: true,
} as const

export const CoreCreateSchema = CoreSchema.omit(CoreOmitSchema).extend({
  createdAt: FieldValueSchema.optional(),
})

export const CoreUpdateSchema = CoreSchema.omit(CoreOmitSchema).extend({
  updatedAt: FieldValueSchema,
})

// TODO implement this
// https://github.com/colinhacks/zod/discussions/2050
export const makeOptionalFieldsToServerDelete = <
  Schema extends z.ZodObject<z.ZodRawShape>,
>(
  schema: Schema,
) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const entries = Object.entries(schema.shape) as [
    keyof Schema['shape'],
    z.ZodTypeAny,
  ][]
  const newProps = entries.reduce<
    {
      [key in keyof Schema['shape']]: Schema['shape'][key] extends z.ZodOptional<
        infer T
      > ? z.ZodNullable<T>
        : Schema['shape'][key]
    }
  >((acc, [key, value]) => {
    // eslint-disable-next-line
    // @ts-ignore ignore
    acc[key] = value instanceof z.ZodOptional ? FieldValueSchema : value
    return acc
    // eslint-disable-next-line
    // @ts-ignore ignore
  }, {})
  // eslint-disable-next-line
  // @ts-ignore ignore
  return z.object(newProps)
}
