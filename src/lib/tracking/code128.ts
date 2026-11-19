// Code 128 (character set B) barcode for the tracking ID, drawn as plain bars
// so a label can go to any printer through the normal print dialog. The Zebra
// path draws the same barcode on the printer itself (^BC in the ZPL template).

// Bar and space widths, in modules, for symbol values 0-106 (106 is Stop).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

const START_B = 104
const STOP = 106

/** Text that set B can carry: printable ASCII, space to tilde. */
export function isCode128BText(text: string): boolean {
  return text.length > 0 && /^[\x20-\x7e]+$/.test(text)
}

/** The symbol values, including start, check digit and stop. */
export function code128BValues(text: string): number[] {
  if (!isCode128BText(text)) throw new Error('Code 128 set B carries printable ASCII only')
  const values = [START_B, ...[...text].map((ch) => ch.charCodeAt(0) - 32)]
  const check = values.reduce((sum, value, index) => sum + value * (index === 0 ? 1 : index), 0) % 103
  return [...values, check, STOP]
}

/** Alternating bar/space widths in modules, starting with a bar. */
export function code128BWidths(text: string): number[] {
  return code128BValues(text).flatMap((value) => [...PATTERNS[value]].map(Number))
}

/** Total width in modules, without quiet zones. */
export function code128BModuleCount(text: string): number {
  return code128BWidths(text).reduce((sum, width) => sum + width, 0)
}

/** The bars as [start, width] pairs in modules. */
export function code128BBars(text: string): Array<[number, number]> {
  const bars: Array<[number, number]> = []
  let x = 0
  code128BWidths(text).forEach((width, index) => {
    if (index % 2 === 0) bars.push([x, width])
    x += width
  })
  return bars
}
