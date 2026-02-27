import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/track
 *
 * Server-side proxy that forwards event tracking requests to the user's
 * configured backend endpoint. This avoids CORS issues and localhost
 * resolution problems when the app runs in a sandboxed environment.
 *
 * Expected body:
 * {
 *   "target_url": "http://localhost:3000/track",
 *   "auth_token": "YOUR_AUTH_TOKEN",
 *   "payload": {
 *     "event": "agent_created",
 *     "distinct_id": "user-123",
 *     "properties": { ... }
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { target_url, auth_token, payload } = body

    if (!target_url) {
      return NextResponse.json(
        { success: false, error: 'target_url is required' },
        { status: 400 }
      )
    }

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
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Proxy request failed'
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
