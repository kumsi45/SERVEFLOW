export function formatPreparationEstimate(minutes: number | null | undefined) {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }

  const lowerBound = Math.max(5, Math.floor(minutes / 5) * 5);
  const upperBound = lowerBound < 20 ? lowerBound + 5 : lowerBound + 10;
  return `${lowerBound}–${upperBound} min`;
}
