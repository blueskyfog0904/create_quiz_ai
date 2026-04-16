export function normalizeChoiceMarkers(text: string): string {
  return text
    .replace(/(^|\n)\s*①\s+/g, '$1(1) ')
    .replace(/(^|\n)\s*②\s+/g, '$1(2) ')
    .replace(/(^|\n)\s*③\s+/g, '$1(3) ')
    .replace(/(^|\n)\s*④\s+/g, '$1(4) ')
    .replace(/(^|\n)\s*⑤\s+/g, '$1(5) ')
    .replace(/(^|\n)\s*([1-5])[\.)]\s+/g, '$1($2) ')
}

export function normalizeOcrPassageText(passage: string): string {
  return normalizeChoiceMarkers(
    passage
      .replace(/\[(?:blank|BLANK)\]/g, '_____')
      .replace(/\((?:blank|BLANK)\)/g, '_____')
      .replace(/_{2,}/g, '_____')
  ).trim()
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
