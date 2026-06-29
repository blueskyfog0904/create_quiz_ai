import type { ReactNode } from 'react'

interface PolicyDocumentContentProps {
  content: string
  title?: string
}

function flushList(items: string[], blocks: ReactNode[]) {
  if (items.length === 0) {
    return
  }

  blocks.push(
    <ul key={`list-${blocks.length}`} className="list-disc pl-6 leading-relaxed text-gray-700">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  )
  items.length = 0
}

export function PolicyDocumentContent({ content, title }: PolicyDocumentContentProps) {
  const blocks: ReactNode[] = []
  const pendingListItems: string[] = []
  const lines = content.replace(/\r\n/g, '\n').split('\n')

  lines.forEach((rawLine) => {
    const line = rawLine.trim()

    if (!line) {
      flushList(pendingListItems, blocks)
      return
    }

    if (line === `# ${title}`) {
      return
    }

    if (line.startsWith('- ')) {
      pendingListItems.push(line.slice(2).trim())
      return
    }

    flushList(pendingListItems, blocks)

    if (line.startsWith('### ')) {
      blocks.push(
        <h3 key={`h3-${blocks.length}`} className="text-lg font-semibold text-gray-900">
          {line.slice(4).trim()}
        </h3>
      )
      return
    }

    if (line.startsWith('## ')) {
      blocks.push(
        <h2 key={`h2-${blocks.length}`} className="text-xl font-bold text-gray-900">
          {line.slice(3).trim()}
        </h2>
      )
      return
    }

    if (line.startsWith('# ')) {
      blocks.push(
        <h2 key={`h1-${blocks.length}`} className="text-2xl font-bold text-gray-900">
          {line.slice(2).trim()}
        </h2>
      )
      return
    }

    blocks.push(
      <p key={`p-${blocks.length}`} className="leading-relaxed text-gray-700">
        {line}
      </p>
    )
  })

  flushList(pendingListItems, blocks)

  return <div className="flex flex-col gap-4">{blocks}</div>
}
