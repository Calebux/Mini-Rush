/** Fail closed on malformed operator settings; never let NaN disable a cap. */
export function boundedSetting(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value !== undefined && !/^\d+(?:\.\d{1,3})?$/.test(value)) throw new Error('Invalid sponsorship configuration');
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error('Invalid sponsorship configuration');
  return number;
}
export const grantMessage = (account: string, at: number) => `minirush:test-near:${account}:${at}`;
