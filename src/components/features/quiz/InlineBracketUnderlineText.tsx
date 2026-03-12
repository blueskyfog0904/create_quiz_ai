import { Fragment } from 'react'
import { splitBracketUnderlineSegments } from '@/lib/questions/normalize-question-field'
import { cn } from '@/lib/utils'

interface InlineBracketUnderlineTextProps {
  as?: 'div' | 'p' | 'span'
  className?: string
  text: string | null | undefined
  underlineClassName?: string
  noUnderline?: boolean
}

export function InlineBracketUnderlineText({
  as = 'div',
  className,
  text,
  underlineClassName,
  noUnderline = false,
}: InlineBracketUnderlineTextProps) {
  if (!text) {
    return null
  }

  const Component = as

  if (noUnderline) {
    return <Component className={className}>{text}</Component>
  }

  const segments = splitBracketUnderlineSegments(text)

  return (
    <Component className={className}>
      {segments.map((segment, index) => {
        if (segment.type === 'underline') {
          return (
            <span
              key={`segment-${index}`}
              className={cn('underline decoration-[3px] underline-offset-[3px] font-normal', underlineClassName)}
            >
              {segment.value}
            </span>
          )
        }

        return <Fragment key={`segment-${index}`}>{segment.value}</Fragment>
      })}
    </Component>
  )
}
