export function isUnder13(
  birthday: Date | string | null | undefined,
  now = new Date(),
) {
  if (!birthday) return false;
  const date =
    birthday instanceof Date ? birthday : new Date(birthday + "T00:00:00.000Z");
  if (!Number.isFinite(date.getTime())) return false;
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  if (
    now.getUTCMonth() < date.getUTCMonth() ||
    (now.getUTCMonth() === date.getUTCMonth() &&
      now.getUTCDate() < date.getUTCDate())
  )
    age--;
  return age < 13;
}
