import { useEffect, useState } from 'react';
import { OverviewPanel } from './components/OverviewPanel';
import { LiveTransactionsTable } from './components/LiveTransactionsTable';
import { RiskCharts } from './components/RiskCharts';
import type { OverviewStats, TransactionLogEntry } from './types';

const POLL_INTERVAL_MS = 2000;

function App() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [transactions, setTransactions] = useState<TransactionLogEntry[]>([]);
  const [riskBuckets, setRiskBuckets] = useState<number[]>(new Array(10).fill(0));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchAll = async () => {
      try {
        const [overviewRes, recentRes, riskRes] = await Promise.all([
          fetch('/api/stats/overview'),
          fetch('/api/stats/recent?limit=50'),
          fetch('/api/stats/risk-distribution')
        ]);

        if (!overviewRes.ok || !recentRes.ok || !riskRes.ok) {
          throw new Error('Backend not reachable');
        }

        const overviewJson = (await overviewRes.json()) as OverviewStats;
        const recentJson = (await recentRes.json()) as TransactionLogEntry[];
        const riskJson = (await riskRes.json()) as { counts: number[] };

        if (!mounted) return;

        setOverview(overviewJson);
        setTransactions(recentJson);
        setRiskBuckets(riskJson.counts);
        setError(null);
      } catch (err) {
        if (!mounted) return;
        setError('Waiting for backend at http://localhost:8000 ...');
      }
    };

    fetchAll();
    const id = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-50">TrustGuard Fraud Monitoring</h1>
            <p className="text-xs text-slate-400">
              Real-time fraud & anomaly detection for digital wallets – supporting SDG 8.10
            </p>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div className="font-mono">API: /check-transaction</div>
            <div>Anonymized, privacy-first monitoring</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {error && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            {error}
          </div>
        )}

        <OverviewPanel stats={overview} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <LiveTransactionsTable transactions={transactions} />
          </div>
          <div className="lg:col-span-1">
            <RiskCharts riskBuckets={riskBuckets} />
          </div>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-300 space-y-2">
          <h2 className="text-sm font-semibold text-slate-100">Demo scenario</h2>
          <ol className="list-decimal list-inside space-y-1">
            <li>Send a normal transaction via POST `/check-transaction` → expected decision: APPROVE.</li>
            <li>Send a slightly unusual transaction (new merchant / time) → expected decision: FLAG.</li>
            <li>Send a high-risk transaction (large amount, new device, overseas, bad IP) → expected decision: BLOCK.</li>
            <li>Observe the AI explanation in the `reason` field and in the dashboard timelines.</li>
          </ol>
        </section>
      </main>
    </div>
  );
}

export default App;

