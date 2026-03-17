import type { TransactionLogEntry } from '../types';

interface Props {
  walletId: string;
  onWalletIdChange: (id: string) => void;
  transactions: TransactionLogEntry[];
}

export const UserBehaviorDashboard: React.FC<Props> = ({ walletId, onWalletIdChange, transactions }) => {
  if (transactions.length === 0) {
    return (
      <section className="space-y-4">
        <Header walletId={walletId} onWalletIdChange={onWalletIdChange} />
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-400">
          No transactions yet for this wallet. Once the user starts transacting, this view will show their normal
          behavior profile and highlight anomalies.
        </div>
      </section>
    );
  }

  const amounts = transactions.map((t) => t.amount);
  const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;

  const days = new Set(transactions.map((t) => t.timestamp.slice(0, 10)));
  const dailyAvg = transactions.length / Math.max(days.size, 1);

  const locationCounts = transactions.reduce<Record<string, number>>((acc, tx) => {
    acc[tx.location] = (acc[tx.location] ?? 0) + 1;
    return acc;
  }, {});
  const commonLocation =
    Object.keys(locationCounts).sort((a, b) => (locationCounts[b] ?? 0) - (locationCounts[a] ?? 0))[0] ??
    'Insufficient data';

  const hours = transactions.map((t) => new Date(t.timestamp).getHours()).sort((a, b) => a - b);
  const p = (q: number) => hours[Math.floor((q / 100) * (hours.length - 1))] ?? 0;
  const typicalStart = p(10);
  const typicalEnd = p(90);

  const anomalies = transactions.filter((t) => {
    const h = new Date(t.timestamp).getHours();
    const amountDeviation = t.amount > avgAmount * 3;
    const timeAnomaly = h < typicalStart || h > typicalEnd;
    return amountDeviation || timeAnomaly || t.decision === 'BLOCK';
  });

  const latestAnomaly = anomalies[anomalies.length - 1];

  return (
    <section className="space-y-6">
      <Header walletId={walletId} onWalletIdChange={onWalletIdChange} />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
        <MetricCard label="Average transaction" value={`RM ${avgAmount.toFixed(2)}`} />
        <MetricCard label="Daily transactions" value={dailyAvg.toFixed(1)} />
        <MetricCard label="Common location" value={commonLocation} />
        <MetricCard
          label="Typical time window"
          value={`${formatHour(typicalStart)} – ${formatHour(typicalEnd)}`}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <div className="md:col-span-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs">
          <h3 className="text-sm font-semibold text-slate-100 mb-2">Spending history</h3>
          <p className="text-slate-400 mb-3">
            Recent transactions for this wallet. This history is used to learn the baseline behavior.
          </p>
          <div className="max-h-64 overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead className="border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="px-2 py-1 text-left">Time</th>
                  <th className="px-2 py-1 text-left">Amount</th>
                  <th className="px-2 py-1 text-left">Location</th>
                  <th className="px-2 py-1 text-left">Merchant</th>
                  <th className="px-2 py-1 text-left">Decision</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-t border-slate-800/60">
                    <td className="px-2 py-1 text-slate-400">
                      {new Date(tx.timestamp).toLocaleString(undefined, {
                        hour12: false
                      })}
                    </td>
                    <td className="px-2 py-1 text-slate-100 font-semibold">RM {tx.amount.toFixed(2)}</td>
                    <td className="px-2 py-1 text-slate-200">{tx.location}</td>
                    <td className="px-2 py-1 text-slate-200">{tx.merchant_id}</td>
                    <td className="px-2 py-1">
                      {tx.decision === 'APPROVE' && <span className="text-approve font-semibold">APPROVE</span>}
                      {tx.decision === 'FLAG' && <span className="text-flag font-semibold">FLAG</span>}
                      {tx.decision === 'BLOCK' && <span className="text-block font-semibold">BLOCK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="md:col-span-2 space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs">
            <h3 className="text-sm font-semibold text-slate-100 mb-2">Behavioral profile explanation</h3>
            <p className="text-slate-300">
              The model learns what is "normal" for this wallet: typical ticket size, usual locations, and the hours the
              user usually spends. Transactions that deviate strongly from this baseline are treated as anomalies and
              assigned higher risk scores.
            </p>
          </div>

          <div className="rounded-xl border border-amber-600/60 bg-amber-500/10 p-4 text-xs text-amber-100">
            <h3 className="text-sm font-semibold mb-1">⚠ Anomaly detection</h3>
            {!latestAnomaly && <p>No strong anomalies detected yet for this wallet.</p>}
            {latestAnomaly && (
              <div className="space-y-1">
                <div>
                  Transaction at{' '}
                  {new Date(latestAnomaly.timestamp).toLocaleTimeString(undefined, { hour12: false })}.
                </div>
                <div>Amount: RM {latestAnomaly.amount.toFixed(2)}</div>
                <div>
                  Deviation from average: +{Math.max(latestAnomaly.amount - avgAmount, 0).toFixed(2)} RM
                </div>
                <div>
                  Decision: <span className="font-semibold">{latestAnomaly.decision}</span>
                </div>
                <div className="text-amber-200/80 mt-1">
                  This card shows how the engine explains anomalies to build user trust.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

const Header: React.FC<{ walletId: string; onWalletIdChange: (id: string) => void }> = ({
  walletId,
  onWalletIdChange
}) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
    <div>
      <h2 className="text-sm font-semibold text-slate-100">User Transaction Dashboard</h2>
      <p className="text-xs text-slate-400">
        Behavioral profiling view for a single wallet. Used by the ML model to learn what is normal before flagging
        anomalies.
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
);

const MetricCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
    <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
    <div className="mt-1 text-lg font-semibold text-slate-100">{value}</div>
  </div>
);

const formatHour = (h: number) => `${h.toString().padStart(2, '0')}:00`;

