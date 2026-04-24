import { saveAs } from 'file-saver'

export async function requestExamPaperHtmlPdf({
  html,
  fileName,
  disposition = 'attachment',
}: {
  html: string
  fileName: string
  disposition?: 'attachment' | 'inline'
}) {
  const response = await fetch('/api/exam-papers/print-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, fileName, disposition }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.message || payload?.error || 'PDF 생성 요청에 실패했습니다.')
  }

  return response.blob()
}

export async function downloadExamPaperHtmlPdf({ html, fileName }: { html: string; fileName: string }) {
  const blob = await requestExamPaperHtmlPdf({ html, fileName, disposition: 'attachment' })
  saveAs(blob, fileName)
}

export async function openExamPaperHtmlPdfInNewTab({ html, fileName }: { html: string; fileName: string }) {
  const blob = await requestExamPaperHtmlPdf({ html, fileName, disposition: 'inline' })
  const url = URL.createObjectURL(blob)
  const openedWindow = window.open(url, '_blank', 'noopener,noreferrer')

  if (!openedWindow) {
    URL.revokeObjectURL(url)
    throw new Error('팝업이 차단되어 PDF 새 탭을 열 수 없습니다.')
  }

  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
