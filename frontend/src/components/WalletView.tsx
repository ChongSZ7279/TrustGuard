import { useState } from 'react';
import type { CheckTransactionResult, TransactionLogEntry } from '../types';
import { apiUrl } from '../api';

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<CheckTransactionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        ip_reputation: 0.8
      };

      const res = await fetch(apiUrl('/check-transaction'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        throw new Error('Request failed');
      }

      const json = (await res.json()) as CheckTransactionResult;
      setResult(json);
    } catch (err) {
      setError('Failed to reach /check-transaction – check that the FastAPI backend is running.');
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

      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <form
          onSubmit={handleSubmit}
          className="md:col-span-2 rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3 text-xs"
        >
          <h3 className="text-sm font-semibold text-slate-100 mb-1">Send Money</h3>

          <div className="space-y-1">
            <label className="block text-slate-400">
              Amount (RM)
              <input
                type="number"
                min="0"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full h-8 rounded-md border border-slate-700 bg-slate-950/60 px-2 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </label>
          </div>

          <div className="space-y-1">
            <label className="block text-slate-400">
              Receiver
              <input
                value={receiver}
                onChange={(e) => setReceiver(e.target.value)}
                className="mt-1 w-full h-8 rounded-md border border-slate-700 bg-slate-950/60 px-2 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </label>
          </div>

          <div className="space-y-1">
            <label className="block text-slate-400">
              Device
              <input
                value={device}
                onChange={(e) => setDevice(e.target.value)}
                className="mt-1 w-full h-8 rounded-md border border-slate-700 bg-slate-950/60 px-2 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </label>
          </div>

          <div className="space-y-1">
            <label className="block text-slate-400">
              Location
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="mt-1 w-full h-8 rounded-md border border-slate-700 bg-slate-950/60 px-2 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-3 inline-flex items-center rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {isSubmitting ? 'Checking risk…' : 'Send payment & check risk'}
          </button>

          {error && <div className="text-[11px] text-amber-300 mt-2">{error}</div>}
        </form>

        <div className="md:col-span-3 space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs">
            <h3 className="text-sm font-semibold text-slate-100 mb-2">Real-Time Fraud Result</h3>
            {!result && <p className="text-slate-500">Submit a transaction to see the risk score and decision.</p>}
            {result && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Risk Score:</span>
                  <span className="font-mono text-sm text-slate-100">
                    {result.risk_score.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Status:</span>
                  <span className="font-semibold">
                    {result.decision === 'APPROVE' && '✅ Approved'}
                    {result.decision === 'FLAG' && '⚠ Flagged'}
                    {result.decision === 'BLOCK' && '⛔ Blocked'}
                  </span>
                </div>
                {result.reason && (
                  <div className="mt-2 text-slate-300">
                    <span className="text-slate-400">Reason:</span> {result.reason}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs">
            <h3 className="text-sm font-semibold text-slate-100 mb-2">Recent Wallet Transactions</h3>
            <div className="max-h-56 overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="border-b border-slate-800 text-slate-400">
                  <tr>
                    <th className="px-2 py-1 text-left">Time</th>
                    <th className="px-2 py-1 text-left">Amount</th>
                    <th className="px-2 py-1 text-left">Receiver</th>
                    <th className="px-2 py-1 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="border-t border-slate-800/60">
                      <td className="px-2 py-1 text-slate-400">
                        {new Date(tx.timestamp).toLocaleTimeString(undefined, { hour12: false })}
                      </td>
                      <td className="px-2 py-1 text-slate-100 font-semibold">RM {tx.amount.toFixed(2)}</td>
                      <td className="px-2 py-1 text-slate-200">{tx.merchant_id}</td>
                      <td className="px-2 py-1">
                        {tx.decision === 'APPROVE' && <span className="text-approve font-semibold">Approved</span>}
                        {tx.decision === 'FLAG' && <span className="text-flag font-semibold">⚠ Flagged</span>}
                        {tx.decision === 'BLOCK' && <span className="text-block font-semibold">⛔ Blocked</span>}
                      </td>
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-4 text-center text-slate-500">
                        No transactions for this wallet yet. Send a payment above to see real-time decisions.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

