import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_PRINT_HTML_BYTES = 1_000_000

const PrintPdfSchema = z.object({
  html: z.string().min(1).max(MAX_PRINT_HTML_BYTES),
  fileName: z.string().optional(),
  disposition: z.enum(['attachment', 'inline']).optional(),
})

function sanitizePdfFileName(fileName: string | undefined) {
  const fallback = 'exam-paper.pdf'
  const normalized = (fileName || fallback)
    .replace(/[\\/\0\r\n"]/g, '_')
    .trim()

  if (!normalized) {
    return fallback
  }

  return normalized.toLowerCase().endsWith('.pdf') ? normalized : `${normalized}.pdf`
}

function buildContentDisposition(disposition: 'attachment' | 'inline', fileName: string | undefined) {
  const sanitizedFileName = sanitizePdfFileName(fileName)
  const encodedFileName = encodeURIComponent(sanitizedFileName)

  return `${disposition}; filename="exam-paper.pdf"; filename*=UTF-8''${encodedFileName}`
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ message: 'Please login first' }, { status: 401 })
    }

    const contentLength = Number(request.headers.get('content-length') || '0')
    if (contentLength > MAX_PRINT_HTML_BYTES + 10_000) {
      return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 })
    }

    const body = await request.json()
    const validation = PrintPdfSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
    }

    const {
      html,
      fileName,
      disposition = 'attachment',
    } = validation.data

    const { chromium } = await import('playwright')
    const browser = await chromium.launch({ headless: true, timeout: 15_000 })

    try {
      const context = await browser.newContext({ javaScriptEnabled: false })
      const page = await context.newPage()
      page.setDefaultTimeout(15_000)
      page.setDefaultNavigationTimeout(15_000)

      await page.route('**/*', (route) => {
        const url = route.request().url()

        if (url === 'about:blank' || url.startsWith('data:') || url.startsWith('blob:')) {
          return route.continue()
        }

        return route.abort()
      })
      await page.emulateMedia({ media: 'print' })
      await page.setContent(html, { waitUntil: 'domcontentloaded' })
      await page.evaluate(() => document.fonts?.ready)

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
      })

      await context.close()

      return new NextResponse(new Blob([Uint8Array.from(pdf)], { type: 'application/pdf' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': buildContentDisposition(disposition, fileName),
        },
      })
    } finally {
      await browser.close()
    }
  } catch (error) {
    console.error('PDF generation error:', error)
    return NextResponse.json(
      { error: 'PDF_GENERATION_FAILED', message: error instanceof Error ? error.message : 'PDF 생성 실패' },
      { status: 500 }
    )
  }
}
