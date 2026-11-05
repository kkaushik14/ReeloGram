import { isUnder13 } from "./age.ts";
export function accountAccess(user: {
  name?: string;
  emailVerifiedAt?: Date;
  dateOfBirth?: Date;
  parent?: { verifiedAt?: Date; ownerApprovedAt?: Date };
}) {
  const profileComplete =
    !!user.name?.trim() &&
    user.dateOfBirth instanceof Date &&
    Number.isFinite(user.dateOfBirth.getTime());
  const parentRequired = isUnder13(user.dateOfBirth);
  const emailVerified = !!user.emailVerifiedAt;
  const parentConfirmed =
    parentRequired &&
    !!user.parent?.verifiedAt &&
    !!user.parent?.ownerApprovedAt;
  return {
    emailVerified,
    profileComplete,
    parentRequired,
    parentConfirmed,
    canPublish:
      profileComplete && emailVerified && (!parentRequired || parentConfirmed),
  };
}
export function publishingAccessError(user: {
  emailVerified?: boolean;
  profileComplete?: boolean;
  parentRequired?: boolean;
  parentConfirmed?: boolean;
}) {
  if (!user.emailVerified)
    return "Confirm your email from Profile before uploading or publishing.";
  if (!user.profileComplete)
    return "Complete your name and date of birth in Profile before uploading or publishing.";
  if (user.parentRequired && !user.parentConfirmed)
    return "Your parent or guardian must confirm account management from their email before you can upload or publish.";
  return null;
}
