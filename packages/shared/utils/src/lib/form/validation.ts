let weakPasswords: typeof import('./weak_passwords.ts').default | undefined;

export const minPasswordLength = 8;

export const refinePasswordLength = (password: string): boolean =>
  password.length >= minPasswordLength;

export const refinePasswordStrength = async (password: string): Promise<boolean> => {
  if (!weakPasswords) {
    weakPasswords = (await import('./weak_passwords.ts')).default;
  }
  return !weakPasswords.includes(password as (typeof weakPasswords)[number]);
};
