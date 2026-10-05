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
