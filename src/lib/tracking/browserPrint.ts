// Talks to Zebra Browser Print, the free Zebra program installed on the PC next
// to the printer. A website cannot reach a label printer without it.
//
// A successful send means the program accepted the label. It does not prove the
// label came out correctly, which is why the operator confirms each print.

export type SendResult =
  | { ok: true }
  | { ok: false; reason: 'agent_missing' | 'no_printer' | 'send_failed' }

const AGENT_URL = typeof window !== 'undefined' && window.location.protocol === 'http:'
  ? 'http://127.0.0.1:9100/'
  : 'https://127.0.0.1:9101/'

async function agentFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(AGENT_URL + path, { ...init, signal: AbortSignal.timeout(6000) })
}

export async function sendToZebra(zpl: string): Promise<SendResult> {
  let device: unknown
  try {
    const res = await agentFetch('default?type=printer')
    if (!res.ok) return { ok: false, reason: 'no_printer' }
    const text = await res.text()
    device = text.trim() ? JSON.parse(text) : null
  } catch {
    return { ok: false, reason: 'agent_missing' }
  }
  if (!device) return { ok: false, reason: 'no_printer' }

  try {
    const res = await agentFetch('write', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ device, data: zpl }),
    })
    return res.ok ? { ok: true } : { ok: false, reason: 'send_failed' }
  } catch {
    return { ok: false, reason: 'send_failed' }
  }
}

export const SEND_FAILURE_MESSAGE: Record<'agent_missing' | 'no_printer' | 'send_failed', string> = {
  agent_missing: 'Zebra Browser Print is not running on this PC. Install or start it, or download the label file.',
  no_printer: 'Zebra Browser Print has no default printer. Choose one in its settings, then try again.',
  send_failed: 'The printer did not accept the label. Check that it is on and has labels loaded.',
}

export function downloadZpl(zpl: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([zpl], { type: 'text/plain' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
