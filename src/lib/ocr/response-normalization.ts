export function normalizeVisualCropPassages(passages: string[]): string[] {
  const normalized = passages
    .map((passage) => passage.trim())
    .filter(Boolean)

  if (normalized.length === 0) {
    return []
  }

  return [normalized.join('\n\n')]
}
