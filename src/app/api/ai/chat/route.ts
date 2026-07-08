import { NextRequest, NextResponse } from 'next/server'
import type Anthropic from '@anthropic-ai/sdk'
import { verifySessionCookie } from '@/lib/auth/session'
import { getAnthropicClient } from '@/lib/ai/anthropic'
import { SYSTEM_PROMPT, TOOLS, executeTool, type LedgerBlock } from '@/lib/ai/tools'

const MODEL = 'claude-opus-4-8'
const MAX_ITERATIONS = 4

export async function POST(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const incoming = Array.isArray(body.messages) ? body.messages : []
  if (incoming.length === 0) {
    return NextResponse.json({ error: 'messages is required' }, { status: 400 })
  }

  const messages: Anthropic.MessageParam[] = incoming.map((m: { role: string; content: string }) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }))

  try {
    const client = getAnthropicClient()
    let ledgerBlock: LedgerBlock | undefined
    let finalText = ''

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8192,
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      })

      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use')
      const textBlocks = response.content.filter((b) => b.type === 'text')
      const text = textBlocks.map((b) => ('text' in b ? b.text : '')).join('\n').trim()
      if (text) finalText = text

      if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
        break
      }

      messages.push({ role: 'assistant', content: response.content })

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of toolUseBlocks) {
        if (block.type !== 'tool_use') continue
        try {
          const { result, ledgerBlock: lb } = await executeTool(
            block.name,
            (block.input ?? {}) as Record<string, unknown>
          )
          if (lb) ledgerBlock = lb
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          })
        } catch (err) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: err instanceof Error ? err.message : 'Tool execution failed',
            is_error: true,
          })
        }
      }
      messages.push({ role: 'user', content: toolResults })
    }

    return NextResponse.json({
      reply: finalText || "I wasn't able to find an answer for that.",
      ledger: ledgerBlock,
    })
  } catch (err) {
    console.error('[AI chat]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Chat request failed' },
      { status: 500 }
    )
  }
}
