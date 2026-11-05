export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export type AccountProfile = {
  name: string;
  email: string;
  dateOfBirth: string | null;
  image: string | null;
};
