import { isUnder13 } from "./age.ts";
import { validateEmailAddress } from "../email/address.ts";
import { AuthRequestError } from "../security/request.ts";
import { createConfirmation } from "./confirmation.ts";
export async function requestedParent(
  body: Record<string, unknown>,
  birthday: Date,
  email: string,
  validate = validateEmailAddress,
) {
  if (!isUnder13(birthday)) {
    if (body.parentManaged === true || body.parentEmail)
      throw new AuthRequestError(
        "Parent management is available for accounts under 13.",
      );
    return null;
  }
  if (body.parentManaged !== true)
    throw new AuthRequestError(
      "A parent or guardian must agree to manage an account for someone under 13.",
    );
  let parentEmail: string;
  try {
    parentEmail = await validate(body.parentEmail);
  } catch (error) {
    if (error instanceof AuthRequestError)
      throw new AuthRequestError(
        `Parent email: ${error.message}`,
        error.status,
      );
    throw error;
  }
  if (parentEmail === email)
    throw new AuthRequestError(
      "Use a different email address for your parent or guardian.",
    );
  const confirmation = createConfirmation("parent");
  return {
    record: {
      email: parentEmail,
      requestedAt: new Date(),
      confirmation: confirmation.stored,
    },
    token: confirmation.token,
  };
}
