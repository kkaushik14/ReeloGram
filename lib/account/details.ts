import { parseDateOfBirth, parseName } from "../auth/validation.ts";
import { AuthRequestError } from "../security/request.ts";

export function parseMissingDetails(value: Record<string, unknown>) {
  const keys = Object.keys(value);
  if (
    !keys.length ||
    keys.some((key) => key !== "name" && key !== "dateOfBirth")
  )
    throw new AuthRequestError(
      "Only missing name and date of birth can be added here.",
    );
  const details: { name?: string; dateOfBirth?: Date } = {};
  if (Object.hasOwn(value, "name")) {
    const name = parseName(value.name);
    if (!name)
      throw new AuthRequestError("Enter a name of up to 80 characters.");
    details.name = name;
  }
  if (Object.hasOwn(value, "dateOfBirth")) {
    const date = parseDateOfBirth(value.dateOfBirth);
    if (!date)
      throw new AuthRequestError(
        "Enter a valid date of birth, within the last 120 years.",
      );
    details.dateOfBirth = date;
  }
  return details;
}
