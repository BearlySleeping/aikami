// packages/frontend/services/src/lib/base/base_form_model.svelte.ts

import { minPasswordLength } from '@aikami/utils';
import type { TSchema } from 'typebox';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from './base_view_model.svelte.ts';

export type BaseFormViewModelOptions = BaseViewModelOptions & {
  initialValues: Record<string, unknown>;
  getInitialValues?: () => Promise<Record<string, unknown>>;
  schema: FormSchema;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
};

/** The interface for the form view model */
export type BaseFormViewModelInterface<FormSchema extends TSchema> = {
  /** Form data */
  readonly form: Record<string, unknown>;
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
  form = $state({} as Record<string, unknown>);
  isSubmitting = $state(false);

  protected _errors = $state<Partial<Record<string, string>>>({});

  private readonly _initialValues: Record<string, unknown>;
  private readonly _getInitialValues: (() => Promise<Record<string, unknown>>) | undefined;

  private readonly _onSubmitCallback: (values: Record<string, unknown>) => Promise<void>;

  constructor(options: BaseFormViewModelOptions<FormSchema> & Options) {
    super(options);
    const { initialValues, onSubmit } = options;

    this._initialValues = initialValues;
    this.form = initialValues;
    this._getInitialValues = options.getInitialValues;

    this._onSubmitCallback = onSubmit;
  }

  async validateField(key: string): Promise<[true] | [false, string]> {
    // TODO: Implement TypeBox runtime validation
    // TypeBox v1.x schemas are JSON Schema — validation needs a separate validator
    const value = this.form[key];
    if (value === undefined || value === null || value === '') {
      return [false, 'Required'];
    }
    return [true];
  }
  async handleSubmit(): Promise<boolean> {
    if (this.isSubmitting) {
      this.warn('handleSubmit: already submitting');
      return false;
    }
    const formValue = this.form;
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
      const translate = (key: string) => {
        return key.replace(/([a-zA-Z])(?=[A-Z])/g, '$1_').toLowerCase();
      };

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
}
