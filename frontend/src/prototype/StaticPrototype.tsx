import { OverviewPanel } from '../components/OverviewPanel';
import { LiveTransactionsTable } from '../components/LiveTransactionsTable';
import { RiskCharts } from '../components/RiskCharts';
import type { OverviewStats, TransactionLogEntry, Decision } from '../types';

// --- Static demo data (no backend required) ---

const staticTransactions: TransactionLogEntry[] = [
  {
    id: 1,
    user_id: 'U1001',
    amount: 18.5,
    location: 'Johor',
    device_id: 'device_U1001_main',
    merchant_id: 'GROCERY_01',
    decision: 'APPROVE',
    risk_score: 0.08,
    timestamp: new Date().toISOString()
  },
  {
    id: 2,
    user_id: 'U1001',
    amount: 12.3,
    location: 'Johor',
    device_id: 'device_U1001_main',
    merchant_id: 'TRANSPORT_01',
    decision: 'APPROVE',
    risk_score: 0.05,
    timestamp: new Date().toISOString()
  },
  {
    id: 3,
    user_id: 'U1001',
    amount: 120.0,
    location: 'Kuala Lumpur',
    device_id: 'device_U1001_main',
    merchant_id: 'ONLINE_SHOP_11',
    decision: 'FLAG',
    risk_score: 0.45,
    timestamp: new Date().toISOString()
  },
  {
    id: 4,
    user_id: 'U1002',
    amount: 2000.0,
    location: 'Singapore',
    device_id: 'new_device_234',
    merchant_id: 'ELEC_99',
    decision: 'BLOCK',
    risk_score: 0.91,
    timestamp: new Date().toISOString()
  },
  {
    id: 5,
    user_id: 'U1003',
    amount: 8.5,
    location: 'Bangkok',
    device_id: 'device_U1003_main',
    merchant_id: 'GROCERY_02',
    decision: 'APPROVE',
    risk_score: 0.07,
    timestamp: new Date().toISOString()
  },
  {
    id: 6,
    user_id: 'U1003',
    amount: 650.0,
    location: 'Overseas',
    device_id: 'device_U1003_new',
    merchant_id: 'TRAVEL_73',
    decision: 'FLAG',
    risk_score: 0.62,
    timestamp: new Date().toISOString()
  }
];

const computeOverview = (txs: TransactionLogEntry[]): OverviewStats => {
  const total = txs.length;
  const counts: Record<Decision, number> = { APPROVE: 0, FLAG: 0, BLOCK: 0 };
  txs.forEach((t) => {
    counts[t.decision]++;
  });
  const fraudRate = total > 0 ? counts.BLOCK / total : 0;
  return {
    total_transactions: total,
    approved: counts.APPROVE,
    flagged: counts.FLAG,
    blocked: counts.BLOCK,
    fraud_rate: fraudRate
  };
};

const computeBuckets = (txs: TransactionLogEntry[], bucketCount = 10): number[] => {
  const buckets = new Array(bucketCount).fill(0);
  txs.forEach((t) => {
    const idx = Math.min(bucketCount - 1, Math.floor(t.risk_score * bucketCount));
    buckets[idx]++;
  });
  return buckets;
};

const overview = computeOverview(staticTransactions);
const buckets = computeBuckets(staticTransactions);

/**
 * StaticPrototype
 *
 * Pure frontend prototype with:
 * - static overview stats
 * - static transaction list
 * - static risk-score distribution
 *
 * No backend or API calls required – ideal for quick UI demos.
 */
export function StaticPrototype() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-50">
              TrustGuard Prototype – Static Frontend
            </h1>
            <p className="text-xs text-slate-400">
              Frontend-only demo with static fraud decisions (no backend required)
            </p>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div>Mode: Offline prototype</div>
            <div>Data: Hard-coded sample transactions</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        <OverviewPanel stats={overview} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <LiveTransactionsTable transactions={staticTransactions} />
          </div>
          <div className="lg:col-span-1">
            <RiskCharts riskBuckets={buckets} />
          </div>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-300 space-y-2">
          <h2 className="text-sm font-semibold text-slate-100">How to use this prototype</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>
              This view does not call any API – it is safe to run offline or without starting the FastAPI backend.
            </li>
            <li>
              To use it as the main app, change `src/main.tsx` to render `StaticPrototype` instead of `App`.
            </li>
            <li>
              You can tweak the static list in `src/prototype/StaticPrototype.tsx` to simulate different fraud patterns.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}

