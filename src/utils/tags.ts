export function normalizeTags(input: string) {
  return input
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}
