'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { callAIAgent } from '@/lib/aiAgent';
import {
  VscTerminal,
  VscCheck,
  VscError,
  VscTrash,
  VscEye,
  VscEyeClosed,
  VscGear,
  VscHistory,
  VscPlay,
  VscCircleFilled,
  VscCopy,
  VscChevronDown,
  VscChevronRight,
} from 'react-icons/vsc';

// --- TypeScript Interfaces ---

interface AgentResponse {
  event_name?: string;
  distinct_id?: string;
  timestamp?: string;
  properties_json?: string;
  properties?: Record<string, unknown>;
  status_message?: string;
}

interface EventHistoryEntry {
  id: string;
  timestamp: string;
  eventName: string;
  statusCode: number | null;
  responseBody: string;
  curlCommand: string;
  payload: string;
  success: boolean;
  pending: boolean;
}

interface InlineNotification {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ConfigState {
  baseUrl: string;
  authToken: string;
}

// --- Constants ---

const EVENT_TESTER_AGENT_ID = '69a148443fa1c5bfc0e93fc4';

const AGENT_LIFECYCLE_EVENTS = [
  { name: 'agent_created', label: 'agent_created' },
  { name: 'agent_updated', label: 'agent_updated' },
  { name: 'agent_deleted', label: 'agent_deleted' },
];

const USER_ACTION_EVENTS = [
  { name: 'user_login', label: 'user_login' },
  { name: 'user_signup', label: 'user_signup' },
  { name: 'feature_used', label: 'feature_used' },
  { name: 'session_started', label: 'session_started' },
];

const MAX_HISTORY = 50;

// --- ErrorBoundary ---

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground font-mono">
          <div className="text-center p-8 max-w-md">
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-muted-foreground mb-4 text-sm">{this.state.error}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: '' })}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-mono tracking-wider"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Helper: generate simple ID ---

function generateId(): string {
  return Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
}

// --- Helper: format timestamp ---

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

// --- Helper: build curl command ---

function buildCurlCommand(
  url: string,
  authToken: string,
  payload: Record<string, unknown>
): string {
  const parts = [`curl -X POST ${url}`];
  if (authToken.trim()) {
    parts.push(`  -H "Authorization: Bearer ${authToken}"`);
  }
  parts.push(`  -H "Content-Type: application/json"`);
  parts.push(`  -d '${JSON.stringify(payload, null, 2)}'`);
  return parts.join(' \\\n');
}

// --- Helper: detect if URL is localhost ---

function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '0.0.0.0' ||
      parsed.hostname === '::1'
    );
  } catch {
    return false;
  }
}

// --- Inline Notification Bar Component ---

function NotificationBar({
  notification,
  onDismiss,
}: {
  notification: InlineNotification | null;
  onDismiss: () => void;
}) {
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (notification) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onDismiss();
      }, 4000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [notification, onDismiss]);

  if (!notification) return null;

  const bgClass =
    notification.type === 'success'
      ? 'border-primary bg-primary/10'
      : notification.type === 'error'
        ? 'border-destructive bg-destructive/10'
        : 'border-muted-foreground bg-muted/50';

  const iconEl =
    notification.type === 'success' ? (
      <VscCheck className="w-4 h-4 text-primary flex-shrink-0" />
    ) : notification.type === 'error' ? (
      <VscError className="w-4 h-4 text-destructive flex-shrink-0" />
    ) : (
      <VscCircleFilled className="w-4 h-4 text-muted-foreground flex-shrink-0" />
    );

  return (
    <div className={`border px-4 py-2 flex items-center gap-3 font-mono text-xs tracking-wider transition-all duration-300 ${bgClass}`}>
      {iconEl}
      <span className="text-foreground flex-1">{notification.message}</span>
      <button
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        x
      </button>
    </div>
  );
}

// --- Event Button Component ---

function EventButton({
  eventName,
  disabled,
  loading,
  onClick,
}: {
  eventName: string;
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex items-center gap-3 w-full px-4 py-3 border text-left font-mono text-xs tracking-wider transition-all duration-200 ${
        disabled
          ? 'border-border bg-muted/30 text-muted-foreground cursor-not-allowed opacity-50'
          : loading
            ? 'border-primary bg-primary/5 text-primary animate-pulse cursor-wait'
            : 'border-border bg-card text-foreground hover:border-primary hover:bg-primary/5 cursor-pointer'
      }`}
    >
      <VscPlay className={`w-3.5 h-3.5 flex-shrink-0 ${loading ? 'animate-spin' : ''}`} />
      <span className="flex-1">{eventName}</span>
      {loading && (
        <span className="text-primary text-[10px]">GENERATING...</span>
      )}
    </button>
  );
}

// --- Config Panel Component ---

function ConfigPanel({
  config,
  onConfigChange,
  configSaved,
  onSave,
  showToken,
  onToggleToken,
}: {
  config: ConfigState;
  onConfigChange: (field: keyof ConfigState, value: string) => void;
  configSaved: boolean;
  onSave: () => void;
  showToken: boolean;
  onToggleToken: () => void;
}) {
  return (
    <div className="border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-4">
        <VscGear className="w-4 h-4 text-primary" />
        <h2 className="font-mono text-sm tracking-wider text-foreground font-semibold">
          ENDPOINT CONFIGURATION
        </h2>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <VscCircleFilled
            className={`w-3 h-3 ${configSaved ? 'text-primary' : 'text-muted-foreground'}`}
          />
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground">
            {configSaved ? 'CONFIGURED' : 'NOT CONFIGURED'}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <div>
          <label className="block font-mono text-[10px] tracking-wider text-muted-foreground mb-1 uppercase">
            Base URL
          </label>
          <input
            type="text"
            placeholder="http://localhost:3000"
            value={config.baseUrl}
            onChange={(e) => onConfigChange('baseUrl', e.target.value)}
            className="w-full bg-input border border-border px-3 py-2 font-mono text-xs tracking-wider text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>
        <div>
          <label className="block font-mono text-[10px] tracking-wider text-muted-foreground mb-1 uppercase">
            Auth Token
          </label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              placeholder="Bearer token..."
              value={config.authToken}
              onChange={(e) => onConfigChange('authToken', e.target.value)}
              className="w-full bg-input border border-border px-3 py-2 pr-9 font-mono text-xs tracking-wider text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
            />
            <button
              type="button"
              onClick={onToggleToken}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showToken ? (
                <VscEyeClosed className="w-4 h-4" />
              ) : (
                <VscEye className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
        <button
          onClick={onSave}
          disabled={!config.baseUrl.trim()}
          className="px-5 py-2 bg-primary text-primary-foreground font-mono text-xs tracking-wider font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          SAVE CONFIG
        </button>
      </div>
      <p className="mt-2 font-mono text-[10px] tracking-wider text-muted-foreground">
        Events POST to {'{'} base_url {'}'}/track. For localhost URLs, a ready-to-run curl command is generated.
      </p>
    </div>
  );
}

// --- Copy Button Component ---

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={`flex items-center gap-1 px-2 py-1 border font-mono text-[10px] tracking-wider transition-colors ${
        copied
          ? 'border-primary text-primary bg-primary/10'
          : 'border-border text-muted-foreground hover:text-foreground hover:border-primary'
      }`}
    >
      {copied ? <VscCheck className="w-3 h-3" /> : <VscCopy className="w-3 h-3" />}
      {copied ? 'COPIED' : 'COPY'}
    </button>
  );
}

// --- History Row with Expandable Details ---

function HistoryRow({ entry }: { entry: EventHistoryEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-2.5 font-mono text-[11px] tracking-wider text-muted-foreground whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            {expanded ? (
              <VscChevronDown className="w-3 h-3 flex-shrink-0" />
            ) : (
              <VscChevronRight className="w-3 h-3 flex-shrink-0" />
            )}
            {formatTimestamp(entry.timestamp)}
          </div>
        </td>
        <td className="px-4 py-2.5 font-mono text-[11px] tracking-wider text-foreground">
          {entry.eventName}
        </td>
        <td className="px-4 py-2.5">
          {entry.pending ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] tracking-wider border border-primary/50 text-primary bg-primary/5">
              <VscCircleFilled className="w-2 h-2 animate-pulse" />
              READY
            </span>
          ) : entry.statusCode !== null ? (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] tracking-wider border ${
                entry.success
                  ? 'border-primary/50 text-primary bg-primary/5'
                  : 'border-destructive/50 text-destructive bg-destructive/5'
              }`}
            >
              {entry.success ? (
                <VscCheck className="w-3 h-3" />
              ) : (
                <VscError className="w-3 h-3" />
              )}
              {entry.statusCode}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] tracking-wider border border-destructive/50 text-destructive bg-destructive/5">
              <VscError className="w-3 h-3" />
              ERR
            </span>
          )}
        </td>
        <td className="px-4 py-2.5 font-mono text-[10px] tracking-wider text-muted-foreground max-w-xs truncate">
          {entry.pending ? 'Payload generated -- expand for curl command' : entry.responseBody}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/50">
          <td colSpan={4} className="px-4 py-3 bg-muted/10">
            {/* Payload */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  Payload
                </span>
                <CopyButton text={entry.payload} />
              </div>
              <pre className="font-mono text-[10px] tracking-wider text-foreground bg-background border border-border p-3 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                {entry.payload}
              </pre>
            </div>
            {/* Curl Command */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  Curl Command
                </span>
                <CopyButton text={entry.curlCommand} />
              </div>
              <pre className="font-mono text-[10px] tracking-wider text-primary bg-background border border-border p-3 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                {entry.curlCommand}
              </pre>
            </div>
            {/* Response (if not pending) */}
            {!entry.pending && entry.responseBody && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                    Response
                  </span>
                  <CopyButton text={entry.responseBody} />
                </div>
                <pre className="font-mono text-[10px] tracking-wider text-muted-foreground bg-background border border-border p-3 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {entry.responseBody}
                </pre>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// --- History Table Component ---

function HistoryPanel({
  history,
  onClear,
}: {
  history: EventHistoryEntry[];
  onClear: () => void;
}) {
  return (
    <div className="border border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <VscHistory className="w-4 h-4 text-primary" />
        <h2 className="font-mono text-sm tracking-wider text-foreground font-semibold">
          EVENT HISTORY
        </h2>
        <span className="font-mono text-[10px] tracking-wider text-muted-foreground">
          [{history.length}/{MAX_HISTORY}]
        </span>
        <div className="flex-1" />
        {history.length > 0 && (
          <button
            onClick={onClear}
            className="flex items-center gap-1.5 px-3 py-1 border border-border text-muted-foreground hover:text-destructive hover:border-destructive font-mono text-[10px] tracking-wider transition-colors"
          >
            <VscTrash className="w-3 h-3" />
            CLEAR
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <VscTerminal className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-40" />
          <p className="font-mono text-xs tracking-wider text-muted-foreground">
            No events fired yet. Configure your endpoint and click an event button above.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-card border-b border-border z-10">
              <tr>
                <th className="text-left px-4 py-2 font-mono text-[10px] tracking-wider text-muted-foreground font-normal uppercase">
                  Timestamp
                </th>
                <th className="text-left px-4 py-2 font-mono text-[10px] tracking-wider text-muted-foreground font-normal uppercase">
                  Event Name
                </th>
                <th className="text-left px-4 py-2 font-mono text-[10px] tracking-wider text-muted-foreground font-normal uppercase">
                  Status
                </th>
                <th className="text-left px-4 py-2 font-mono text-[10px] tracking-wider text-muted-foreground font-normal uppercase">
                  Response
                </th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <HistoryRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Agent Info Panel ---

function AgentInfoPanel({ activeAgentId }: { activeAgentId: string | null }) {
  return (
    <div className="border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <VscTerminal className="w-4 h-4 text-primary flex-shrink-0" />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            Agent:
          </span>
          <span className="font-mono text-[11px] tracking-wider text-foreground truncate">
            Event Tester Agent
          </span>
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground hidden sm:inline">
            [{EVENT_TESTER_AGENT_ID}]
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <VscCircleFilled
            className={`w-2.5 h-2.5 ${activeAgentId ? 'text-primary animate-pulse' : 'text-muted-foreground'}`}
          />
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground">
            {activeAgentId ? 'PROCESSING' : 'IDLE'}
          </span>
        </div>
      </div>
    </div>
  );
}

// --- Main Page Export ---

export default function Page() {
  // Config state
  const [config, setConfig] = useState<ConfigState>({
    baseUrl: '',
    authToken: '',
  });
  const [configSaved, setConfigSaved] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // Event history
  const [history, setHistory] = useState<EventHistoryEntry[]>([]);

  // Loading states per event
  const [loadingEvents, setLoadingEvents] = useState<Record<string, boolean>>({});

  // Inline notification
  const [notification, setNotification] = useState<InlineNotification | null>(null);

  // Active agent tracking
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);

  const handleConfigChange = useCallback(
    (field: keyof ConfigState, value: string) => {
      setConfig((prev) => ({ ...prev, [field]: value }));
      setConfigSaved(false);
    },
    []
  );

  const handleSaveConfig = useCallback(() => {
    if (config.baseUrl.trim()) {
      setConfigSaved(true);
      showNotification('Endpoint configuration saved.', 'success');
    }
  }, [config.baseUrl]);

  const showNotification = useCallback(
    (message: string, type: 'success' | 'error' | 'info') => {
      setNotification({ id: generateId(), message, type });
    },
    []
  );

  const dismissNotification = useCallback(() => {
    setNotification(null);
  }, []);

  const addHistoryEntry = useCallback((entry: EventHistoryEntry) => {
    setHistory((prev) => {
      const next = [entry, ...prev];
      return next.slice(0, MAX_HISTORY);
    });
  }, []);

  const updateHistoryEntry = useCallback((id: string, updates: Partial<EventHistoryEntry>) => {
    setHistory((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry))
    );
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    showNotification('Event history cleared.', 'info');
  }, [showNotification]);

  const handleFireEvent = useCallback(
    async (eventName: string) => {
      if (!configSaved) return;

      setLoadingEvents((prev) => ({ ...prev, [eventName]: true }));
      setActiveAgentId(EVENT_TESTER_AGENT_ID);

      try {
        // Step 1: Call the agent to generate a test payload
        const agentResult = await callAIAgent(
          `Generate a test payload for the ${eventName} event`,
          EVENT_TESTER_AGENT_ID
        );

        if (!agentResult?.success) {
          const errMsg =
            agentResult?.error ?? agentResult?.response?.message ?? 'Agent call failed';
          showNotification(`Agent error: ${errMsg}`, 'error');
          addHistoryEntry({
            id: generateId(),
            timestamp: new Date().toISOString(),
            eventName,
            statusCode: null,
            responseBody: errMsg,
            curlCommand: '',
            payload: '',
            success: false,
            pending: false,
          });
          setLoadingEvents((prev) => ({ ...prev, [eventName]: false }));
          setActiveAgentId(null);
          return;
        }

        // Extract response data - handle multiple response shapes
        let data: AgentResponse = {};
        const rawResult = agentResult?.response?.result;
        const rawMessage = agentResult?.response?.message;

        // If result is a string (error or text response), try to parse it
        if (typeof rawResult === 'string') {
          try {
            data = JSON.parse(rawResult);
          } catch {
            const errorText = rawResult || rawMessage || 'Agent returned non-JSON response';
            showNotification(`Agent: ${errorText}`, 'error');
            addHistoryEntry({
              id: generateId(),
              timestamp: new Date().toISOString(),
              eventName,
              statusCode: null,
              responseBody: errorText,
              curlCommand: '',
              payload: '',
              success: false,
              pending: false,
            });
            setLoadingEvents((prev) => ({ ...prev, [eventName]: false }));
            setActiveAgentId(null);
            return;
          }
        } else if (rawResult && typeof rawResult === 'object') {
          // Check if it's a text-type error response
          if ('text' in rawResult && typeof rawResult.text === 'string' && !rawResult.event_name) {
            showNotification(`Agent: ${rawResult.text}`, 'error');
            addHistoryEntry({
              id: generateId(),
              timestamp: new Date().toISOString(),
              eventName,
              statusCode: null,
              responseBody: rawResult.text,
              curlCommand: '',
              payload: '',
              success: false,
              pending: false,
            });
            setLoadingEvents((prev) => ({ ...prev, [eventName]: false }));
            setActiveAgentId(null);
            return;
          }
          data = rawResult as AgentResponse;
        }

        // Parse properties_json string into object if present
        let parsedProperties: Record<string, unknown> = {};
        if (data?.properties_json) {
          try {
            parsedProperties = JSON.parse(data.properties_json);
          } catch {
            parsedProperties = {};
          }
        } else if (data?.properties && typeof data.properties === 'object') {
          parsedProperties = data.properties;
        }

        const payload = {
          event: data?.event_name ?? eventName,
          distinct_id: data?.distinct_id ?? crypto.randomUUID(),
          timestamp: data?.timestamp ?? new Date().toISOString(),
          properties: parsedProperties,
        };

        const trackUrl = `${config.baseUrl.replace(/\/$/, '')}/track`;
        const curlCmd = buildCurlCommand(trackUrl, config.authToken, payload);
        const payloadStr = JSON.stringify(payload, null, 2);
        const entryId = generateId();
        const isLocalhost = isLocalhostUrl(config.baseUrl);

        if (isLocalhost) {
          // Localhost: cannot reach from sandbox -- generate payload + curl, mark as READY
          addHistoryEntry({
            id: entryId,
            timestamp: new Date().toISOString(),
            eventName: payload.event,
            statusCode: null,
            responseBody: '',
            curlCommand: curlCmd,
            payload: payloadStr,
            success: true,
            pending: true,
          });

          showNotification(
            `Payload generated for ${payload.event}. Copy the curl command from history to run locally.`,
            'success'
          );
        } else {
          // Public URL: attempt direct POST, also provide curl as fallback
          addHistoryEntry({
            id: entryId,
            timestamp: new Date().toISOString(),
            eventName: payload.event,
            statusCode: null,
            responseBody: 'Sending...',
            curlCommand: curlCmd,
            payload: payloadStr,
            success: false,
            pending: true,
          });

          const trackHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (config.authToken.trim()) {
            trackHeaders['Authorization'] = `Bearer ${config.authToken}`;
          }

          try {
            const response = await fetch(trackUrl, {
              method: 'POST',
              headers: trackHeaders,
              body: JSON.stringify(payload),
            });

            let responseText = '';
            try {
              responseText = await response.text();
            } catch {
              responseText = '(unable to read response body)';
            }

            const isSuccess = response.status >= 200 && response.status < 300;

            updateHistoryEntry(entryId, {
              statusCode: response.status,
              responseBody: responseText,
              success: isSuccess,
              pending: false,
            });

            showNotification(
              isSuccess
                ? `${payload.event} -- ${response.status} OK${data?.status_message ? ' -- ' + data.status_message : ''}`
                : `${payload.event} -- ${response.status} FAILED`,
              isSuccess ? 'success' : 'error'
            );
          } catch (networkErr) {
            const errMsg =
              networkErr instanceof Error ? networkErr.message : 'Network error';

            updateHistoryEntry(entryId, {
              statusCode: null,
              responseBody: `Network error: ${errMsg}. Use the curl command instead.`,
              success: false,
              pending: false,
            });

            showNotification(
              `Cannot reach ${trackUrl}. Curl command available in history.`,
              'error'
            );
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        showNotification(`Error: ${errMsg}`, 'error');
        addHistoryEntry({
          id: generateId(),
          timestamp: new Date().toISOString(),
          eventName,
          statusCode: null,
          responseBody: errMsg,
          curlCommand: '',
          payload: '',
          success: false,
          pending: false,
        });
      } finally {
        setLoadingEvents((prev) => ({ ...prev, [eventName]: false }));
        setActiveAgentId(null);
      }
    },
    [configSaved, config, showNotification, addHistoryEntry, updateHistoryEntry]
  );

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-background text-foreground font-mono tracking-wider">
        {/* Header */}
        <header className="border-b border-border bg-card">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <VscTerminal className="w-5 h-5 text-primary" />
              <h1 className="text-sm font-semibold text-foreground tracking-widest uppercase">
                Event Tracker
              </h1>
              <span className="text-[10px] text-muted-foreground tracking-wider border border-border px-2 py-0.5">
                v1.0
              </span>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-6xl mx-auto px-4 py-4 space-y-4">
          {/* Inline Notification */}
          <NotificationBar
            notification={notification}
            onDismiss={dismissNotification}
          />

          {/* Config Panel (sticky) */}
          <div className="sticky top-0 z-10">
            <ConfigPanel
              config={config}
              onConfigChange={handleConfigChange}
              configSaved={configSaved}
              onSave={handleSaveConfig}
              showToken={showToken}
              onToggleToken={() => setShowToken((prev) => !prev)}
            />
          </div>

          {/* Event Button Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Agent Lifecycle */}
            <div className="border border-border bg-card">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <VscGear className="w-3.5 h-3.5 text-primary" />
                <h3 className="font-mono text-xs tracking-wider text-foreground font-semibold uppercase">
                  Agent Lifecycle
                </h3>
              </div>
              <div className="p-3 space-y-2">
                {AGENT_LIFECYCLE_EVENTS.map((evt) => (
                  <EventButton
                    key={evt.name}
                    eventName={evt.label}
                    disabled={!configSaved}
                    loading={!!loadingEvents[evt.name]}
                    onClick={() => handleFireEvent(evt.name)}
                  />
                ))}
              </div>
            </div>

            {/* User Actions */}
            <div className="border border-border bg-card">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <VscPlay className="w-3.5 h-3.5 text-primary" />
                <h3 className="font-mono text-xs tracking-wider text-foreground font-semibold uppercase">
                  User Actions
                </h3>
              </div>
              <div className="p-3 space-y-2">
                {USER_ACTION_EVENTS.map((evt) => (
                  <EventButton
                    key={evt.name}
                    eventName={evt.label}
                    disabled={!configSaved}
                    loading={!!loadingEvents[evt.name]}
                    onClick={() => handleFireEvent(evt.name)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Not Configured Hint */}
          {!configSaved && (
            <div className="border border-border bg-muted/20 px-4 py-6 text-center">
              <VscTerminal className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-50" />
              <p className="font-mono text-xs tracking-wider text-muted-foreground">
                Enter your tracking endpoint URL and auth token above, then click &quot;SAVE CONFIG&quot; to begin firing events.
              </p>
            </div>
          )}

          {/* Event History */}
          <HistoryPanel
            history={history}
            onClear={clearHistory}
          />

          {/* Agent Info */}
          <AgentInfoPanel activeAgentId={activeAgentId} />
        </main>

        {/* Footer */}
        <footer className="border-t border-border mt-8">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <span className="font-mono text-[10px] tracking-wider text-muted-foreground">
              EVENT TRACKER TESTING UI
            </span>
            <span className="font-mono text-[10px] tracking-wider text-muted-foreground">
              POWERED BY LYZR AGENT
            </span>
          </div>
        </footer>
      </div>
    </ErrorBoundary>
  );
}
