export function normalize(value, fallback = "") {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return value;
}
