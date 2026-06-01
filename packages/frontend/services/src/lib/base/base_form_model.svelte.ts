// packages/frontend/services/src/lib/base/base_form_model.svelte.ts

import { minPasswordLength } from '@aikami/utils';
import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from './base_view_model.svelte.ts';

export type BaseFormViewModelOptions<FormSchema extends TSchema> = BaseViewModelOptions & {
  initialValues: Static<FormSchema>;
  getInitialValues?: () => Promise<Static<FormSchema>>;
  schema: FormSchema;
  onSubmit: (values: Static<FormSchema>) => Promise<void>;
};

/** The interface for the form view model */
export type BaseFormViewModelInterface<FormSchema extends TSchema> = {
  /** Form data */
  readonly form: Static<FormSchema>;
  /** Form validation errors */
  readonly errors: Partial<Record<string, string>>;
  /** Indicates if the form is currently being submitted */
  readonly isSubmitting: boolean;

  readonly isValid: boolean;

  handleChange(key: string): Promise<void>;
  /** Handles form submission */
  handleSubmit(): Promise<boolean>;

  validateField(key: string): Promise<[true] | [false, string]>;

  /** Resets the form to its initial values and clears any errors */
  reset(): Promise<void>;
} & BaseViewModelInterface;

/** The abstract form view model class */
export abstract class BaseFormViewModel<
    FormSchema extends TSchema,
    Options extends BaseViewModelOptions = BaseViewModelOptions,
  >
  extends BaseViewModel<Options>
  implements BaseFormViewModelInterface<FormSchema>
{
  form = $state({} as Static<FormSchema>);
  isSubmitting = $state(false);

  protected _errors = $state<Partial<Record<string, string>>>({});

  private readonly _initialValues: Static<FormSchema>;
  private readonly _getInitialValues: (() => Promise<Static<FormSchema>>) | undefined;

  private readonly _schema: FormSchema;
  private readonly _onSubmitCallback: (values: Static<FormSchema>) => Promise<void>;

  constructor(options: BaseFormViewModelOptions<FormSchema> & Options) {
    super(options);
    const { initialValues, onSubmit, schema } = options;

    this._initialValues = initialValues;
    this.form = initialValues;
    this._getInitialValues = options.getInitialValues;

    this._schema = schema;
    this._onSubmitCallback = onSubmit;
  }

  async validateField(key: string): Promise<[true] | [false, string]> {
    const [formIsValid, errors] = this._validateAllFields();
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
    const [formIsValid, errors] = this._validateAllFields();

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
  async handleChange(key: string): Promise<void> {
    await this.validateField(key);
  }
  override async dispose(): Promise<void> {
    await this.reset();
    return super.dispose();
  }

  isValid = $derived(Object.values(this._errors).every((error) => !error));

  errors = $derived(
    (() => {
      const errors: Partial<Record<string, string>> = {};
      for (const [field, errorMessage] of Object.entries(this._errors)) {
        if (!errorMessage) {
          continue;
        }

        const message: string = Array.isArray(errorMessage) ? errorMessage[0] : errorMessage;

        let localizedMessage = message;

        if (message === 'validation_error_password_min_x') {
          localizedMessage = `Password must be at least ${minPasswordLength} characters`;
        }

        if (!localizedMessage) {
          this.error('error:missing-localized-error-message', message);
          localizedMessage = message;
        }
        errors[field] = localizedMessage;
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

  private _validateAllFields(): [true] | [false, Partial<Record<string, string>>] {
    const formValue = this.form;
    if (!Value.Check(this._schema, formValue)) {
      const errors = Value.Errors(this._schema, formValue);
      const fieldErrors: Record<string, string> = {};
      for (const error of errors) {
        const path = error.instancePath.replace(/^\//, '');
        if (!fieldErrors[path]) {
          fieldErrors[path] = error.message;
        }
      }
      this.debug('validateAllFields:errors', fieldErrors);
      return [false, fieldErrors];
    }
    return [true];
  }
}
