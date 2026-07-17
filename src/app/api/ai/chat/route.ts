import { NextRequest, NextResponse } from 'next/server'
import type Anthropic from '@anthropic-ai/sdk'
import { verifySessionCookie } from '@/lib/auth/session'
import { getAnthropicClient } from '@/lib/ai/anthropic'
import { SYSTEM_PROMPT, TOOLS, executeTool, type LedgerBlock } from '@/lib/ai/tools'
import {
  createConversation,
  insertMessage,
  touchConversation,
  deleteMessageForRegenerate,
  getConversationOwner,
} from '@/lib/ai/persistence'

const MODEL = 'claude-opus-4-8'
const MAX_ITERATIONS = 4

type ChatFrame =
  | { type: 'conversation_created'; conversationId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'ledger'; ledger: LedgerBlock }
  | { type: 'done'; conversationId: string; messageId: string }
  | { type: 'error'; message: string }

export async function POST(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const incoming = Array.isArray(body.messages) ? body.messages : []
  if (incoming.length === 0) {
    return NextResponse.json({ error: 'messages is required' }, { status: 400 })
  }

  const lastUserMessage = [...incoming].reverse().find((m: { role: string }) => m.role === 'user')
  if (!lastUserMessage) {
    return NextResponse.json({ error: 'messages must include a user message' }, { status: 400 })
  }

  let conversationId: string | undefined =
    typeof body.conversationId === 'string' ? body.conversationId : undefined
  const regenerateMessageId: string | undefined =
    typeof body.regenerateMessageId === 'string' ? body.regenerateMessageId : undefined

  if (conversationId) {
    const owner = await getConversationOwner(conversationId)
    if (owner !== session.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const messages: Anthropic.MessageParam[] = incoming.map((m: { role: string; content: string }) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }))

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (frame: ChatFrame) => {
        controller.enqueue(encoder.encode(JSON.stringify(frame) + '\n'))
      }

      try {
        if (!conversationId) {
          const created = await createConversation(session.userId, lastUserMessage.content)
          conversationId = created.id
          send({ type: 'conversation_created', conversationId })
        }

        // On regenerate, the user's turn was already persisted the first time this
        // message was sent — only the assistant reply is being replaced.
        if (!regenerateMessageId) {
          await insertMessage(conversationId, 'user', lastUserMessage.content)
        } else {
          await deleteMessageForRegenerate(conversationId, regenerateMessageId)
        }

        const client = getAnthropicClient()
        let ledgerBlock: LedgerBlock | undefined
        let finalText = ''

        for (let i = 0; i < MAX_ITERATIONS; i++) {
          if (request.signal.aborted) break

          const anthropicStream = client.messages.stream(
            {
              model: MODEL,
              max_tokens: 8192,
              thinking: { type: 'adaptive' },
              system: SYSTEM_PROMPT,
              tools: TOOLS,
              messages,
            },
            { signal: request.signal }
          )

          anthropicStream.on('text', (delta) => {
            finalText += delta
            send({ type: 'text_delta', text: delta })
          })

          const response = await anthropicStream.finalMessage()

          const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use')
          if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
            break
          }
          if (request.signal.aborted) break

          messages.push({ role: 'assistant', content: response.content })

          const toolResults: Anthropic.ToolResultBlockParam[] = []
          for (const block of toolUseBlocks) {
            if (block.type !== 'tool_use') continue
            try {
              const { result, ledgerBlock: lb } = await executeTool(
                block.name,
                (block.input ?? {}) as Record<string, unknown>
              )
              if (lb) {
                ledgerBlock = lb
                send({ type: 'ledger', ledger: lb })
              }
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

        if (request.signal.aborted) {
          // Client disconnected / stopped generation — don't persist a partial reply.
          return
        }

        const assistantMessage = await insertMessage(
          conversationId,
          'assistant',
          finalText || "I wasn't able to find an answer for that.",
          ledgerBlock
        )
        await touchConversation(conversationId)
        send({ type: 'done', conversationId, messageId: assistantMessage.id })
      } catch (err) {
        if (!request.signal.aborted) {
          console.error('[AI chat]', err)
          send({ type: 'error', message: err instanceof Error ? err.message : 'Chat request failed' })
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  })
}
