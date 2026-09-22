// Validation for player account credentials (username/password/email).
// Pure and framework-free so it is table-driven-testable, matching the
// existing pattern in lib/tournament/players/api.ts (validatePlayerRegistration).

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

const usernamePattern = /^[A-Za-z0-9_]+$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldValidation<T> =
  | { success: true; data: T; error?: undefined }
  | { success: false; data: null; error: string };

export function validateUsername(value: string): FieldValidation<string> {
  const trimmed = value.trim();
  if (trimmed.length < USERNAME_MIN_LENGTH || trimmed.length > USERNAME_MAX_LENGTH) {
    return {
      success: false,
      data: null,
      error: `Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters.`,
    };
  }
  if (!usernamePattern.test(trimmed)) {
    return {
      success: false,
      data: null,
      error: "Username can only contain letters, numbers, and underscores.",
    };
  }
  return { success: true, data: trimmed };
}

export function validatePassword(value: string): FieldValidation<string> {
  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    return {
      success: false,
      data: null,
      error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  return { success: true, data: value };
}

// Email is always optional on a player account -- an empty string is valid
// and normalizes to null.
export function validateOptionalEmail(value: string | null | undefined): FieldValidation<string | null> {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) return { success: true, data: null };
  if (trimmed.length > 254 || !emailPattern.test(trimmed)) {
    return { success: false, data: null, error: "Enter a valid email address." };
  }
  return { success: true, data: trimmed };
}

export type PlayerSignupInput = {
  username: string;
  password: string;
  confirmPassword: string;
  email?: string | null;
};

export type PlayerSignupData = {
  username: string;
  password: string;
  email: string | null;
};

export type PlayerSignupErrors = Partial<Record<"username" | "password" | "confirmPassword" | "email", string>>;

export type PlayerSignupValidation =
  | { success: true; data: PlayerSignupData; errors: Record<string, never> }
  | { success: false; data: null; errors: PlayerSignupErrors };

export function validatePlayerSignup(input: PlayerSignupInput): PlayerSignupValidation {
  const errors: PlayerSignupErrors = {};

  const username = validateUsername(input.username);
  if (!username.success) errors.username = username.error;

  const password = validatePassword(input.password);
  if (!password.success) errors.password = password.error;

  if (password.success && input.confirmPassword !== input.password) {
    errors.confirmPassword = "Passwords do not match.";
  }

  const email = validateOptionalEmail(input.email);
  if (!email.success) errors.email = email.error;

  if (Object.keys(errors).length > 0 || !username.success || !password.success || !email.success) {
    return { success: false, data: null, errors };
  }

  return {
    success: true,
    data: { username: username.data, password: password.data, email: email.data },
    errors: {},
  };
}
