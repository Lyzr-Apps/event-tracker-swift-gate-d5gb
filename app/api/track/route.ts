import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/track
 *
 * Accepts event tracking payloads in the exact format:
 * {
 *   "event": "agent_created",
 *   "distinct_id": "user-123",
 *   "properties": {
 *     "agent_name": "support-bot",
 *     "plan": "premium"
 *   }
 * }
 *
 * Supports Authorization: Bearer <token> header.
 * Forwards the request to the user's configured target URL if provided,
 * otherwise acts as the tracking endpoint itself.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Mode 1: Proxy mode - forward to external target
    if (body.target_url) {
      const { target_url, auth_token, payload } = body

      if (!payload) {
        return NextResponse.json(
          { success: false, error: 'payload is required' },
          { status: 400 }
        )
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (auth_token && auth_token.trim()) {
        headers['Authorization'] = `Bearer ${auth_token}`
      }

      try {
        const response = await fetch(target_url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        })

        let responseText = ''
        try {
          responseText = await response.text()
        } catch {
          responseText = '(unable to read response body)'
        }

        return NextResponse.json({
          success: response.ok,
          status_code: response.status,
          status_text: response.statusText,
          body: responseText,
        })
      } catch (fetchError) {
        const errorMsg = fetchError instanceof Error ? fetchError.message : 'Proxy request failed'
        return NextResponse.json(
          {
            success: false,
            status_code: null,
            status_text: 'Network Error',
            body: errorMsg,
            error: errorMsg,
          },
          { status: 502 }
        )
      }
    }

    // Mode 2: Direct tracking endpoint - accept event payload directly
    const { event, distinct_id, properties } = body

    if (!event) {
      return NextResponse.json(
        { error: 'event field is required' },
        { status: 400 }
      )
    }

    // Log the received event (server-side)
    console.log(`[TRACK] Event received: ${event}`, {
      event,
      distinct_id: distinct_id || 'unknown',
      properties: properties || {},
      timestamp: new Date().toISOString(),
    })

    return NextResponse.json({
      status: 'ok',
      received: true,
      event,
      distinct_id: distinct_id || 'unknown',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Server error'
    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    )
  }
}
