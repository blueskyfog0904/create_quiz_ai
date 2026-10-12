// 구성(서브상품) 다운로드 버튼 이름. 상세 구매 영역과 자료 보관함이 함께 쓴다.
// 구성 이름 끝 괄호의 형식이 파일 형식과 같으면 그대로, 다르면 괄호 안을 파일 형식으로 바꾸고, 괄호가 없으면 (형식)을 붙인다.
// 버튼 칸을 줄이려고 '다운로드'는 붙이지 않는다. 화면 낭독기용 이름은 링크의 aria-label에서 붙인다.
export function getMarketDownloadButtonLabel(file: { fileTypeLabel: string; subproductTitle: string }) {
  const fileTypeLabel = file.fileTypeLabel.trim() || '파일'
  const subproductTitle = file.subproductTitle.trim() || '자료'
  const fileTypeSuffixPattern = /\s*[\(（]([^\)）]*)[\)）]\s*$/
  const fileTypeSuffixMatch = subproductTitle.match(fileTypeSuffixPattern)

  if (fileTypeSuffixMatch?.[1]?.trim() === fileTypeLabel) {
    return subproductTitle
  }

  const typedTitle = subproductTitle.replace(fileTypeSuffixPattern, `(${fileTypeLabel})`)
  return fileTypeSuffixMatch ? typedTitle : `${subproductTitle}(${fileTypeLabel})`
}

// 한 구성에 같은 형식 파일이 여럿이면 버튼 이름이 같아진다. 그런 버튼끼리는 파일 이름(확장자 제외)에서
// 공통 앞부분(마지막 공백·_·- 까지)을 뺀 나머지를 ' · '로 붙여 구분하고, 그래도 구분되지 않으면 순번을 붙인다.
export function getMarketDownloadButtonLabels(
  files: { id: string; fileTypeLabel: string; subproductTitle: string; originalFileName: string }[]
) {
  const groups = new Map<string, typeof files>()
  for (const file of files) {
    const label = getMarketDownloadButtonLabel(file)
    groups.set(label, [...(groups.get(label) ?? []), file])
  }

  const labels = new Map<string, string>()
  for (const [label, group] of groups) {
    if (group.length === 1) {
      labels.set(group[0].id, label)
      continue
    }
    const stems = group.map((file) => file.originalFileName.trim().replace(/\.[^.]+$/, ''))
    const common = stems.reduce((prefix, stem) => {
      let length = 0
      while (length < prefix.length && prefix[length] === stem[length]) length += 1
      return prefix.slice(0, length)
    })
    const cut = Math.max(common.lastIndexOf(' '), common.lastIndexOf('_'), common.lastIndexOf('-')) + 1
    const rests = stems.map((stem) => stem.slice(cut).trim())
    const distinct = rests.every(Boolean) && new Set(rests).size === rests.length
    group.forEach((file, index) => labels.set(file.id, `${label} · ${distinct ? rests[index] : index + 1}`))
  }
  return labels
}
