// Prints labels through the browser's own print dialog, so they reach any
// printer installed on this computer. A hidden frame holds the label page;
// the page sets its own paper size (one label per page, no margins).
//
// The browser does not say whether the operator pressed Print or Cancel, so
// every print is still confirmed by the operator afterwards.
import { labelPageHtml, type PrintableLabel } from './htmlLabel'

export type PrintMethod = 'dialog' | 'zebra'

const METHOD_KEY = 'warecore.tracking.printMethod'

/** How this computer prints labels. Remembered per browser, because Zebra Browser Print is installed per PC. */
export function savedPrintMethod(): PrintMethod {
  try {
    return window.localStorage.getItem(METHOD_KEY) === 'zebra' ? 'zebra' : 'dialog'
  } catch {
    return 'dialog'
  }
}

export function savePrintMethod(method: PrintMethod): void {
  try {
    window.localStorage.setItem(METHOD_KEY, method)
  } catch {
    // Private windows can refuse storage; the choice then lasts for this page only.
  }
}

export const PRINT_METHOD_LABELS: Record<PrintMethod, string> = {
  dialog: 'Print dialog (any printer)',
  zebra: 'Zebra Browser Print (direct)',
}

/** Opens the print dialog for the labels and resolves once it has closed. */
export function printLabelsWithDialog(labels: PrintableLabel[], title?: string): Promise<void> {
  const html = labelPageHtml(labels, title)
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none'
    let finished = false
    const finish = (error?: Error) => {
      if (finished) return
      finished = true
      // Some browsers read the frame after print() returns; remove it a little later.
      setTimeout(() => frame.remove(), 1000)
      if (error) reject(error)
      else resolve()
    }
    frame.onload = () => {
      const view = frame.contentWindow
      if (!view) return finish(new Error('The browser could not prepare the labels for printing'))
      view.addEventListener('afterprint', () => finish())
      try {
        view.focus()
        view.print()
        // Chrome, Edge and Firefox block in print() until the dialog closes.
        finish()
      } catch {
        finish(new Error('The browser blocked the print dialog'))
      }
    }
    frame.srcdoc = html
    document.body.appendChild(frame)
  })
}

/**
 * Opens the labels in a new tab, where they can be printed from the browser
 * menu. For phones and tablets, which often cannot print from a hidden frame.
 * Call it straight from a click, or the browser blocks the new tab.
 */
export function openLabelsInNewTab(labels: PrintableLabel[], title?: string): boolean {
  const url = URL.createObjectURL(new Blob([labelPageHtml(labels, title)], { type: 'text/html' }))
  const opened = window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  return opened !== null
}
