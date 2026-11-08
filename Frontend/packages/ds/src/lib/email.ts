/** The client's one email shape check (name@domain.tld, no spaces), so a typo shows before submitting; the service decides. */
export function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
