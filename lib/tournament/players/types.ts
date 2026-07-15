export type PlayerRegistrationInput = {
  gameTag: string;
};

export type PlayerRegistrationData = {
  gameName: string;
  tagLine: string;
  gameTag: string;
};

export type PlayerRegistrationErrors = Partial<
  Record<keyof PlayerRegistrationInput, string>
>;

export type PlayerRegistrationValidation =
  | {
      success: true;
      data: PlayerRegistrationData;
      errors: PlayerRegistrationErrors;
    }
  | {
      success: false;
      data: null;
      errors: PlayerRegistrationErrors;
    };
