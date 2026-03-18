import { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../api';
import type { BlockedUserEntry, Decision, PersistedTransaction } from '../types';

type PoliceTx = PersistedTransaction & {
  tx_id: string;
  timestamp?: string;
};

const decisionClasses: Record<Decision, string> = {
  APPROVE: 'bg-approve/10 text-approve border-approve/40',
  FLAG: 'bg-flag/10 text-flag border-flag/40',
  BLOCK: 'bg-block/10 text-block border-block/40'
};

export const PolicePanel: React.FC = () => {
  const [policeKey, setPoliceKey] = useState<string>('police-demo-key');
  const [blockUserId, setBlockUserId] = useState<string>('');
  const [blockReason, setBlockReason] = useState<string>('Confirmed fraud / mule account');
  const [blocked, setBlocked] = useState<BlockedUserEntry[]>([]);
  const [todayTx, setTodayTx] = useState<PoliceTx[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');

  const headers = useMemo(
    () => ({
      'Content-Type': 'application/json',
      'X-Police-Key': policeKey
    }),
    [policeKey]
  );

  const refresh = async () => {
    setError(null);
    try {
      const [txRes, blockedRes] = await Promise.all([
        fetch(apiUrl('/police/transactions/today?limit=200'), { headers }),
        fetch(apiUrl('/police/blocked-users?limit=200'), { headers })
      ]);
      if (!txRes.ok || !blockedRes.ok) throw new Error('police unauthorized or backend down');
      setTodayTx(await txRes.json());
      setBlocked(await blockedRes.json());
    } catch {
      setError('Police endpoints not reachable or invalid X-Police-Key.');
      setTodayTx([]);
      setBlocked([]);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredTx = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return todayTx;
    return todayTx.filter((t) => {
      return (
        String(t.user_id ?? '').toLowerCase().includes(q) ||
        String(t.device_id ?? '').toLowerCase().includes(q) ||
        String(t.location ?? '').toLowerCase().includes(q) ||
        String(t.merchant_id ?? '').toLowerCase().includes(q) ||
        String(t.tx_id ?? '').toLowerCase().includes(q) ||
        String(t.decision ?? '').toLowerCase().includes(q)
      );
    });
  }, [todayTx, query]);

  const liveAlerts: PoliceTx[] = useMemo(() => {
    return [...todayTx]
      .sort((a, b) => Number(b.risk_score ?? 0) - Number(a.risk_score ?? 0))
      .filter((t) => (t.risk_score ?? 0) >= 0.8)
      .slice(0, 10);
  }, [todayTx]);

  const block = async () => {
    setError(null);
    try {
      const res = await fetch(apiUrl('/police/block-user'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ user_id: blockUserId, reason: blockReason })
      });
      if (!res.ok) throw new Error('block failed');
      setBlockUserId('');
      await refresh();
    } catch {
      setError('Failed to block user (check key and backend).');
    }
  };

  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs">
        <h2 className="text-sm font-semibold text-slate-100">Police / Investigator Console</h2>
        <p className="text-slate-400">
          Today-only visibility by default (privacy-first). Police can block confirmed fraud users.
        </p>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-slate-400">
            X-Police-Key
            <input
              className="mt-1 w-full h-9 rounded-md border border-slate-700 bg-slate-950/60 px-3 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
              value={policeKey}
              onChange={(e) => setPoliceKey(e.target.value)}
            />
          </label>
          <div className="md:col-span-2 flex items-end gap-2">
            <button
              type="button"
              onClick={refresh}
              className="h-9 rounded-md bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-500"
            >
              Refresh today data
            </button>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search user/device/location/merchant..."
              className="flex-1 h-9 rounded-md border border-slate-700 bg-slate-950/60 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
        </div>

        {error && <div className="mt-3 text-[11px] text-amber-300">{error}</div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs">
          <h3 className="text-sm font-semibold text-slate-100 mb-2">Block a user</h3>
          <div className="grid grid-cols-1 gap-2">
            <label className="text-slate-400">
              User ID
              <input
                className="mt-1 w-full h-9 rounded-md border border-slate-700 bg-slate-950/60 px-3 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                value={blockUserId}
                onChange={(e) => setBlockUserId(e.target.value)}
                placeholder="e.g. user_001"
              />
            </label>
            <label className="text-slate-400">
              Reason
              <input
                className="mt-1 w-full h-9 rounded-md border border-slate-700 bg-slate-950/60 px-3 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={block}
              disabled={!blockUserId.trim()}
              className="mt-1 h-9 rounded-md bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              Block user
            </button>
          </div>

          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">Blocked users</div>
            <div className="max-h-64 overflow-y-auto space-y-2">
              {blocked.map((b) => (
                <div key={b.user_id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-slate-100">{b.user_id}</div>
                    <div className="text-[10px] text-slate-500">
                      {new Date(b.blocked_at).toLocaleString(undefined, { hour12: false })}
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-400">{b.reason}</div>
                </div>
              ))}
              {blocked.length === 0 && <div className="text-slate-500 text-[11px]">No blocked users yet.</div>}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <h3 className="text-sm font-semibold text-slate-100">Today’s transactions (MongoDB)</h3>
            <div className="text-[11px] text-slate-400">
              Visibility limited to today by policy. Use search to find a user and block if needed.
            </div>
          </div>

          <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/30 text-[11px]">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-200">High-risk alerts</div>
              <div className="text-slate-500">risk ≥ 0.80</div>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2">
              {liveAlerts.map((t) => (
                <div key={t.tx_id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-slate-200">{t.user_id}</div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-400">RM {Number(t.amount ?? 0).toFixed(2)}</span>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          decisionClasses[t.decision] ?? 'border-slate-700 text-slate-300'
                        }`}
                      >
                        {t.decision}
                      </span>
                      <span className="font-mono text-slate-400">{Number(t.risk_score ?? 0).toFixed(2)}</span>
                    </div>
                  </div>
                  {t.reason && (
                    <div className="mt-1 text-slate-300 line-clamp-2" title={t.reason}>
                      {t.reason}
                    </div>
                  )}
                </div>
              ))}
              {liveAlerts.length === 0 && <div className="text-slate-500">No high-risk alerts yet.</div>}
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-900/80 sticky top-0 z-10 text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">User</th>
                  <th className="px-3 py-2 text-left">Amount</th>
                  <th className="px-3 py-2 text-left">Location</th>
                  <th className="px-3 py-2 text-left">Device</th>
                  <th className="px-3 py-2 text-left">Merchant</th>
                  <th className="px-3 py-2 text-left">Why?</th>
                  <th className="px-3 py-2 text-left">Decision</th>
                  <th className="px-3 py-2 text-left">Risk</th>
                </tr>
              </thead>
              <tbody>
                {filteredTx.map((t) => (
                  <tr key={String(t.tx_id)} className="border-t border-slate-800/80 hover:bg-slate-800/40">
                    <td className="px-3 py-2 text-slate-400">
                      {new Date(t.created_at ?? t.timestamp ?? new Date().toISOString()).toLocaleTimeString(undefined, {
                        hour12: false
                      })}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-200">{t.user_id}</td>
                    <td className="px-3 py-2 font-semibold text-slate-100">RM {Number(t.amount ?? 0).toFixed(2)}</td>
                    <td className="px-3 py-2 text-slate-200">{t.location}</td>
                    <td className="px-3 py-2 max-w-[140px] truncate text-slate-200" title={t.device_id}>
                      {t.device_id}
                    </td>
                    <td className="px-3 py-2 text-slate-200">{t.merchant_id}</td>
                    <td className="px-3 py-2 max-w-[260px] truncate text-[11px] text-slate-400" title={t.reason ?? ''}>
                      {t.reason ? t.reason : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                          decisionClasses[t.decision as Decision] ?? 'border-slate-700 text-slate-300'
                        }`}
                      >
                        {t.decision}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-200">{Number(t.risk_score ?? 0).toFixed(2)}</td>
                  </tr>
                ))}
                {filteredTx.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                      No transactions yet today (or unauthorized).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
};

