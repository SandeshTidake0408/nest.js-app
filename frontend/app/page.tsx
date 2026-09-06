'use client';
import { useEffect, useState } from 'react';
import { operationsConfig } from './config';

type Attempt = {
  attemptNumber: number;
  workerId: string;
  startedAt: string;
  finishedAt?: string;
  result: string;
  error?: string;
};
type Event = {
  eventId: string;
  type: string;
  status: string;
  attemptCount: number;
  lastError?: string;
  createdAt: string;
  attempts: Attempt[];
};
const api = operationsConfig.apiUrl;

export default function OperationsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState('');
  async function refresh() {
    try {
      const response = await fetch(`${api}/events`);
      if (!response.ok) throw new Error('Could not load events');
      setEvents(await response.json());
      setError('');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not load events',
      );
    }
  }
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, operationsConfig.refreshIntervalMs);
    return () => clearInterval(id);
  }, []);
  async function retry(eventId: string) {
    await fetch(`${api}/events/${encodeURIComponent(eventId)}/retry`, {
      method: 'POST',
    });
    refresh();
  }
  return (
    <main
      style={{ fontFamily: 'system-ui', maxWidth: 1200, margin: '2rem auto' }}
    >
      <h1>Webhook operations</h1>
      <p>Refreshes every two seconds. {error}</p>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            {['Event', 'Type', 'State', 'Attempts', 'Error', 'History', ''].map(
              (h) => (
                <th
                  key={h}
                  style={{
                    borderBottom: '1px solid #999',
                    textAlign: 'left',
                    padding: 8,
                  }}
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.eventId}>
              <td style={{ padding: 8 }}>{event.eventId}</td>
              <td>{event.type}</td>
              <td>{event.status}</td>
              <td>{event.attemptCount}</td>
              <td>{event.lastError}</td>
              <td>
                {event.attempts.map((a) => (
                  <div key={a.attemptNumber}>
                    #{a.attemptNumber} {a.workerId}: {a.result}
                    {a.error ? ` — ${a.error}` : ''}
                  </div>
                ))}
              </td>
              <td>
                {event.status === 'failed' && (
                  <button onClick={() => retry(event.eventId)}>Retry</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
