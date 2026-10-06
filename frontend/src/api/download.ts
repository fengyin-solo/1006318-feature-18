/** 统一的 CSV 下载入口：所有模块导出清单共用，文件名与内容都来自服务层。 */
export function downloadCsv(payload: { filename: string; content: string }): void {
  const blob = new Blob([payload.content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = payload.filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
