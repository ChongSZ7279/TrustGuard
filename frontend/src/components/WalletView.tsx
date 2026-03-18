import { useEffect, useMemo, useState } from 'react';
import type { CheckTransactionResult, PersistedTransaction, TransactionLogEntry } from '../types';
import { apiUrl } from '../api';
import { PhoneFrame } from './PhoneFrame';

interface Props {
  walletId: string;
  onWalletIdChange: (id: string) => void;
  transactions: TransactionLogEntry[];
}

export const WalletView: React.FC<Props> = ({ walletId, onWalletIdChange, transactions }) => {
  const [amount, setAmount] = useState<string>('120');
  const [receiver, setReceiver] = useState<string>('Merchant123');
  const [device, setDevice] = useState<string>('iPhone 15');
  const [location, setLocation] = useState<string>('Johor Bahru');
  const [ipReputation, setIpReputation] = useState<string>('0.8');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<CheckTransactionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [todayHistory, setTodayHistory] = useState<PersistedTransaction[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const mergedHistory = useMemo(() => {
    // Prefer persisted history (today-only). Fall back to in-memory recent list.
    if (todayHistory.length > 0) {
      return todayHistory.map((t, idx) => ({
        id: idx + 1,
        user_id: t.user_id,
        amount: t.amount,
        location: t.location,
        device_id: t.device_id,
        merchant_id: t.merchant_id,
        decision: t.decision,
        risk_score: t.risk_score,
        timestamp: t.created_at
      })) as TransactionLogEntry[];
    }
    return transactions;
  }, [todayHistory, transactions]);

  const refreshToday = async () => {
    setHistoryError(null);
    try {
      const res = await fetch(apiUrl(`/transactions/today?user_id=${encodeURIComponent(walletId)}&limit=50`));
      if (!res.ok) throw new Error('history failed');
      const json = (await res.json()) as any[];
      const normalized: PersistedTransaction[] = json.map((d) => ({
        tx_id: String(d.tx_id ?? d._id ?? ''),
        user_id: String(d.user_id),
        amount: Number(d.amount ?? 0),
        location: String(d.location ?? ''),
        device_id: String(d.device_id ?? ''),
        merchant_id: String(d.merchant_id ?? ''),
        time_str: String(d.time_str ?? ''),
        ip_reputation: d.ip_reputation ?? null,
        decision: d.decision,
        risk_score: Number(d.risk_score ?? 0),
        reason: String(d.reason ?? ''),
        latency_ms: Number(d.latency_ms ?? 0),
        created_at: String(d.created_at ?? d.timestamp ?? new Date().toISOString())
      }));
      setTodayHistory(normalized);
    } catch {
      setHistoryError('Could not load today history from MongoDB yet (is MongoDB running?).');
      setTodayHistory([]);
    }
  };

  useEffect(() => {
    refreshToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const now = new Date();
      const hh = now.getHours().toString().padStart(2, '0');
      const mm = now.getMinutes().toString().padStart(2, '0');

      const body = {
        user_id: walletId,
        amount: Number(amount),
        merchant_id: receiver,
        device_id: device,
        location,
        time: `${hh}:${mm}`,
        ip_reputation: Number(ipReputation)
      };

      const res = await fetch(apiUrl('/transactions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        throw new Error('Request failed');
      }

      const json = (await res.json()) as CheckTransactionResult;
      setResult(json);
      await refreshToday();
    } catch (err) {
      setError('Failed to reach /transactions – check that the FastAPI backend and MongoDB are running.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">User Wallet View</h2>
          <p className="text-xs text-slate-400">
            Simulated digital wallet for an unbanked gig worker or merchant. Shows real-time fraud decisions for each payment.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="text-slate-400">
            Wallet ID
            <input
              className="ml-2 h-7 rounded-md border border-slate-700 bg-slate-950/60 px-2 text-[11px] text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
              value={walletId}
              onChange={(e) => onWalletIdChange(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <PhoneFrame title="Mobile Wallet Simulator">
          <div className="p-4 text-xs space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400">TrustGuard Wallet</div>
                <div className="text-sm font-semibold text-slate-100">Send Money</div>
                <div className="text-[11px] text-slate-400">Real-time fraud shield for the unbanked</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-500">Wallet ID</div>
                <div className="font-mono text-[11px] text-slate-200">{walletId}</div>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-slate-400">
                  Amount (RM)
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="mt-1 w-full h-9 rounded-lg border border-slate-700 bg-slate-950/70 px-3 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </label>
                <label className="block text-slate-400">
                  IP reputation
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={ipReputation}
                    onChange={(e) => setIpReputation(e.target.value)}
                    className="mt-1 w-full h-9 rounded-lg border border-slate-700 bg-slate-950/70 px-3 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </label>
              </div>

              <label className="block text-slate-400">
                Receiver / Merchant
                <input
                  value={receiver}
                  onChange={(e) => setReceiver(e.target.value)}
                  className="mt-1 w-full h-9 rounded-lg border border-slate-700 bg-slate-950/70 px-3 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </label>

              <label className="block text-slate-400">
                Device ID
                <input
                  value={device}
                  onChange={(e) => setDevice(e.target.value)}
                  className="mt-1 w-full h-9 rounded-lg border border-slate-700 bg-slate-950/70 px-3 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </label>

              <label className="block text-slate-400">
                Location
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="mt-1 w-full h-9 rounded-lg border border-slate-700 bg-slate-950/70 px-3 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </label>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full mt-1 inline-flex items-center justify-center rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
              >
                {isSubmitting ? 'Checking…' : 'Send payment'}
              </button>

              {error && <div className="text-[11px] text-amber-300">{error}</div>}
            </form>

            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Decision</div>
              {!result && <div className="text-slate-500">Make a payment to receive an instant decision.</div>}
              {result && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="text-slate-400">Risk</div>
                    <div className="font-mono text-sm text-slate-100">{result.risk_score.toFixed(2)}</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-slate-400">Status</div>
                    <div className="font-semibold">
                      {result.decision === 'APPROVE' && <span className="text-approve">APPROVE</span>}
                      {result.decision === 'FLAG' && <span className="text-flag">FLAG</span>}
                      {result.decision === 'BLOCK' && <span className="text-block">BLOCK</span>}
                    </div>
                  </div>
                  {result.ledger_hash && (
                    <div className="mt-1">
                      <div className="text-slate-400">Ledger hash</div>
                      <div className="font-mono text-[10px] text-slate-300 break-all">{result.ledger_hash}</div>
                    </div>
                  )}
                  {result.reason && (
                    <div className="mt-2 text-[11px] text-slate-300">
                      <span className="text-slate-400">Why:</span> {result.reason}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Today</div>
                  <div className="text-xs font-semibold text-slate-100">Transaction history (today only)</div>
                </div>
                <button
                  type="button"
                  onClick={refreshToday}
                  className="rounded-md border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                >
                  Refresh
                </button>
              </div>
              {historyError && <div className="text-[11px] text-amber-300 mb-2">{historyError}</div>}
              <div className="max-h-52 overflow-y-auto">
                <div className="space-y-2">
                  {mergedHistory.map((tx) => (
                    <div key={tx.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-slate-200 font-semibold">RM {tx.amount.toFixed(2)}</div>
                        <div className="text-[11px] text-slate-400">
                          {new Date(tx.timestamp).toLocaleTimeString(undefined, { hour12: false })}
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-400">{tx.merchant_id}</div>
                      <div className="mt-1 text-[11px]">
                        {tx.decision === 'APPROVE' && <span className="text-approve font-semibold">APPROVE</span>}
                        {tx.decision === 'FLAG' && <span className="text-flag font-semibold">FLAG</span>}
                        {tx.decision === 'BLOCK' && <span className="text-block font-semibold">BLOCK</span>}
                        <span className="text-slate-500"> • risk {tx.risk_score.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                  {mergedHistory.length === 0 && (
                    <div className="text-center text-slate-500 py-4 text-[11px]">
                      No transactions yet today.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </PhoneFrame>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs">
            <h3 className="text-sm font-semibold text-slate-100 mb-2">Wallet settings (demo)</h3>
            <p className="text-slate-400 mb-3">
              Change the wallet ID to simulate different users. The “today” history is stored in MongoDB.
            </p>
            <label className="text-slate-400">
              Wallet ID
              <input
                className="mt-1 w-full h-9 rounded-md border border-slate-700 bg-slate-950/60 px-3 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                value={walletId}
                onChange={(e) => onWalletIdChange(e.target.value)}
              />
            </label>
            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-[11px] text-slate-300">
              <div className="font-semibold text-slate-200 mb-1">Privacy note</div>
              Only anonymized IDs are used. This mirrors an “unbanked-first” design where we minimize PII but still
              protect users from fraud in real time.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

