export function clamp(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) {
    throw new RangeError('minimum darf maximum nicht überschreiten.');
  }

  return Math.min(Math.max(value, minimum), maximum);
}
