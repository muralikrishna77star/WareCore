import ExcelJS from 'exceljs'

/**
 * Flattens an array of plain row objects into a downloaded .xlsx file, right
 * in the browser - no server round-trip. Column order/headers come from the
 * keys of the first row, so callers should build rows with an explicit key
 * order matching what's shown on screen.
 */
export async function exportRowsToExcel(
  rows: Record<string, unknown>[],
  filename: string,
  sheetName = 'Sheet1'
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(sheetName)

  if (rows.length > 0) {
    const columns = Object.keys(rows[0])
    worksheet.columns = columns.map((key) => ({
      header: key,
      key,
      width: Math.min(Math.max(key.length + 2, 12), 40),
    }))
    worksheet.addRows(rows)
    worksheet.getRow(1).font = { bold: true }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
