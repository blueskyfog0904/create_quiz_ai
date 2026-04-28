export function resolveInsertionIndexFromPointer({
  clientY,
  itemTop,
  itemHeight,
  itemIndex,
}: {
  clientY: number
  itemTop: number
  itemHeight: number
  itemIndex: number
}) {
  return clientY > itemTop + itemHeight / 2 ? itemIndex + 1 : itemIndex
}

export function isNoopQuestionInsertion(
  fromIndex: number,
  insertionIndex: number | null
) {
  return insertionIndex === null ||
    insertionIndex === fromIndex ||
    insertionIndex === fromIndex + 1
}

export function resolveQuestionMoveIndex({
  fromIndex,
  insertionIndex,
  totalCount,
}: {
  fromIndex: number
  insertionIndex: number | null
  totalCount: number
}) {
  if (totalCount <= 0 || fromIndex < 0 || fromIndex >= totalCount) {
    return null
  }

  if (insertionIndex === null || insertionIndex < 0 || insertionIndex > totalCount) {
    return null
  }

  if (isNoopQuestionInsertion(fromIndex, insertionIndex)) {
    return null
  }

  return fromIndex < insertionIndex ? insertionIndex - 1 : insertionIndex
}
