export function normalizeOcrPassageText(passage: string): string {
  return passage
    .replace(/\[(?:blank|BLANK)\]/g, '_____')
    .replace(/\((?:blank|BLANK)\)/g, '_____')
    .replace(/_{2,}/g, '_____')
    .trim()
}

export function normalizeVisualCropPassages(passages: string[]): string[] {
  const normalized = passages
    .map((passage) => normalizeOcrPassageText(passage))
    .filter(Boolean)

  if (normalized.length === 0) {
    return []
  }

  return [normalized.join('\n\n')]
}
