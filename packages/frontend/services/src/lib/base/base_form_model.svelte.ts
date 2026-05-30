import type { CoreFormSchema } from '@aikami/schemas';
import { minPasswordLength } from '@aikami/utils';
import type { ZodType, z } from 'zod';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from './base_view_model.svelte.ts';

export type BaseFormViewModelOptions<FormSchema extends ZodType<z.infer<typeof CoreFormSchema>>> =
  BaseViewModelOptions & {
    initialValues: z.infer<FormSchema>;
    getInitialValues?: () => Promise<z.infer<FormSchema>>;
    schema: FormSchema;
    onSubmit: (values: z.infer<FormSchema>) => Promise<void>;
  };

/** The interface for the form view model */
export type BaseFormViewModelInterface<FormSchema extends ZodType<z.infer<typeof CoreFormSchema>>> =
  {
    /** Form data */
    readonly form: z.infer<FormSchema>;
    /** Form validation errors */
    readonly errors: Partial<Record<keyof z.infer<FormSchema>, string>>;
    /** Indicates if the form is currently being submitted */
    readonly isSubmitting: boolean;

    readonly isValid: boolean;

    /**
     * Handles changes in individual form fields
     *
     * @param key - The field key that changed
     */
    handleChange(key: Exclude<keyof z.infer<FormSchema>, 'id'>): Promise<void>;
    /** Handles form submission */
    handleSubmit(): Promise<boolean>;

    /**
     * Validates a single form field and returns the validation result and
     * optional error message
     *
     * @param key The field key to validate
     * @returns Whether the field is valid or not
     */
    validateField(key: keyof z.infer<FormSchema>): Promise<[true] | [false, string]>;

    /** Resets the form to its initial values and clears any errors */
    reset(): Promise<void>;
  } & BaseViewModelInterface;

/** The abstract form view model class */
export abstract class BaseFormViewModel<
    FormSchema extends ZodType<z.infer<typeof CoreFormSchema>>,
    Options extends BaseViewModelOptions = BaseViewModelOptions,
  >
  extends BaseViewModel<Options>
  implements BaseFormViewModelInterface<FormSchema>
{
  form = $state({} as z.infer<FormSchema>);
  isSubmitting = $state(false);

  protected _errors = $state<Partial<Record<keyof z.infer<FormSchema>, string>>>({});

  private readonly _initialValues: z.infer<FormSchema>;
  private readonly _getInitialValues: (() => Promise<z.infer<FormSchema>>) | undefined;

  private readonly _schema: FormSchema;
  private readonly _onSubmitCallback: (values: z.infer<FormSchema>) => Promise<void>;

  constructor(options: BaseFormViewModelOptions<FormSchema> & Options) {
    super(options);
    const { initialValues, onSubmit, schema } = options;

    this._initialValues = initialValues;
    this.form = initialValues;
    this._getInitialValues = options.getInitialValues;

    this._schema = schema;
    this._onSubmitCallback = onSubmit;
  }

  async validateField(key: keyof z.infer<FormSchema>): Promise<[true] | [false, string]> {
    const [formIsValid, errors] = await this._validateAllFields();
    this.log('validateField', formIsValid, errors);
    const fieldError = errors?.[key];

    this._errors = {
      ...this._errors,
      [key]: fieldError,
    };

    if (formIsValid || !fieldError) {
      return [true];
    }

    return [false, String(fieldError)];
  }
  async handleSubmit(): Promise<boolean> {
    if (this.isSubmitting) {
      this.warn('handleSubmit: already submitting');
      return false;
    }
    const formValue = this.form;
    const [formIsValid, errors] = await this._validateAllFields();

    if (!formIsValid) {
      this.log('handleSubmit: form is not valid', {
        errors,
        formValue,
      });
      if (errors) {
        this._errors = errors;
      }
      return false;
    }
    this.isSubmitting = true;
    await this._onSubmitCallback(formValue);
    this.isSubmitting = false;
    return true;
  }
  async handleChange(key: Exclude<keyof z.infer<FormSchema>, 'id'>): Promise<void> {
    await this.validateField(key);
  }
  override async dispose(): Promise<void> {
    await this.reset();
    return super.dispose();
  }

  isValid = $derived(Object.values(this._errors).every((error) => !error));

  errors = $derived(
    (() => {
      const errors: Partial<Record<keyof z.infer<FormSchema>, string>> = {};
      const translate = (key: string, _param = {}) => {
        // convert camelCase to snake_case
        key = key
          .toString()
          .replace(/([a-zA-Z])(?=[A-Z])/g, '$1_')
          .toLowerCase();

        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
        return key;
      };

      for (const [field, errorMessage] of Object.entries(this._errors)) {
        if (!errorMessage) {
          continue;
        }

        const message: string = Array.isArray(errorMessage) ? errorMessage[0] : errorMessage;
        const fieldName: string = translate(field) || field;

        let localizedMessage = translate(message, {
          fieldName,
        });

        if (message === 'validation_error_password_min_x') {
          localizedMessage = translate(message, {
            min: minPasswordLength,
          });
        }

        if (!localizedMessage) {
          this.error('error:missing-localized-error-message', message);
          localizedMessage = message;
        }
        errors[field as keyof z.infer<FormSchema>] = localizedMessage;
      }

      return errors;
    })(),
  );

  override async initialize(): Promise<void> {
    if (this._getInitialValues) {
      this.form = await this._getInitialValues();
    }
  }

  async reset(): Promise<void> {
    this.form = this._getInitialValues ? await this._getInitialValues() : this._initialValues;
    this._errors = {};
  }

  private async _validateAllFields(): Promise<
    [true] | [false, Partial<Record<keyof z.infer<FormSchema>, string>>]
  > {
    const formValue = this.form;
    const result = await this._schema.safeParseAsync(formValue);
    if (result.success) {
      return [true];
    }
    this.debug('validateAllFields:errors', result.error);
    return [
      false,
      result.error.flatten().fieldErrors as Partial<Record<keyof z.infer<FormSchema>, string>>,
    ];
  }
}
