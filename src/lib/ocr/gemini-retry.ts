export function getErrorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { status?: unknown }
  return typeof candidate.status === 'number' ? candidate.status : null
}

export function isRetryableGeminiError(error: unknown): boolean {
  const status = getErrorStatusCode(error)
  return status === 429 || status === 500 || status === 503
}

export function getBackoffDelayMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 8000)
  const jitter = Math.floor(Math.random() * 250)
  return base + jitter
}

interface WithGeminiRetryOptions {
  maxAttempts?: number
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void
  sleep?: (delayMs: number) => Promise<void>
  getDelayMs?: (attempt: number) => number
}

export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  options: WithGeminiRetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs)
  }))
  const getDelayMs = options.getDelayMs ?? getBackoffDelayMs

  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (!isRetryableGeminiError(error) || attempt === maxAttempts - 1) {
        throw error
      }

      const delayMs = getDelayMs(attempt)
      options.onRetry?.(attempt + 1, delayMs, error)
      await sleep(delayMs)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Gemini request failed after retries')
}
