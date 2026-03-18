import { useEffect, useMemo, useState } from 'react';
import { WalletView } from './components/WalletView';
import { UserBehaviorDashboard } from './components/UserBehaviorDashboard';
import { PolicePanel } from './components/PolicePanel';
import { apiUrl } from './api';
import type { Decision, OverviewStats, TransactionLogEntry } from './types';
import logo from './image/image.png';

const POLL_INTERVAL_MS = 2000;

function App() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [transactions, setTransactions] = useState<TransactionLogEntry[]>([]);
  const [riskBuckets, setRiskBuckets] = useState<number[]>(new Array(10).fill(0));
  const [error, setError] = useState<string | null>(null);
   const [activeView, setActiveView] = useState<'wallet' | 'user-dashboard' | 'system-dashboard'>('wallet');
  const [currentWalletId, setCurrentWalletId] = useState<string>('user_001');

  useEffect(() => {
    let mounted = true;

    const fetchAll = async () => {
      try {
        const [overviewRes, recentRes, riskRes] = await Promise.all([
          fetch(apiUrl('/stats/overview-today')),
          fetch(apiUrl('/stats/recent-today?limit=50')),
          fetch(apiUrl('/stats/risk-distribution-today'))
        ]);

        if (!overviewRes.ok || !recentRes.ok || !riskRes.ok) {
          throw new Error('Backend not reachable');
        }

        const overviewJson = (await overviewRes.json()) as OverviewStats;
        const recentJson = (await recentRes.json()) as TransactionLogEntry[];
        const riskJson = (await riskRes.json()) as { buckets: number; counts: number[] };

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

  const currentWalletTransactions = useMemo(
    () => transactions.filter((tx) => tx.user_id === currentWalletId),
    [transactions, currentWalletId]
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={logo}
              alt="TrustGuard"
              className="h-9 w-9 rounded-xl border border-slate-800 bg-white/5 object-contain"
            />
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-50">TrustGuard Fraud Monitoring</h1>
            <p className="text-xs text-slate-400">
              Real-time fraud & anomaly detection for digital wallets – supporting SDG 8.10
            </p>
            </div>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div className="font-mono">API: /risk/score</div>
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

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-2 text-xs text-slate-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold text-slate-100">Views</div>
            <div className="inline-flex rounded-xl border border-slate-700 bg-slate-950/60 p-1 text-[11px]">
              <button
                type="button"
                onClick={() => setActiveView('wallet')}
                className={`px-3 py-1.5 rounded-lg inline-flex items-center gap-2 ${
                  activeView === 'wallet'
                    ? 'bg-sky-600 text-white shadow shadow-sky-500/20'
                    : 'text-slate-300 hover:bg-slate-800/80'
                }`}
              >
                <span aria-hidden>💰</span>
                <span>Wallet</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveView('user-dashboard')}
                className={`px-3 py-1.5 rounded-lg inline-flex items-center gap-2 ${
                  activeView === 'user-dashboard'
                    ? 'bg-sky-600 text-white shadow shadow-sky-500/20'
                    : 'text-slate-300 hover:bg-slate-800/80'
                }`}
              >
                <span aria-hidden>👤</span>
                <span>Behaviour</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveView('system-dashboard')}
                className={`px-3 py-1.5 rounded-lg inline-flex items-center gap-2 ${
                  activeView === 'system-dashboard'
                    ? 'bg-sky-600 text-white shadow shadow-sky-500/20'
                    : 'text-slate-300 hover:bg-slate-800/80'
                }`}
              >
                <span aria-hidden>⚙️</span>
                <span>System</span>
              </button>
            </div>
          </div>
        </section>

        {activeView === 'wallet' && (
          <WalletView
            walletId={currentWalletId}
            onWalletIdChange={setCurrentWalletId}
            transactions={currentWalletTransactions}
          />
        )}

        {activeView === 'user-dashboard' && (
          <UserBehaviorDashboard
            walletId={currentWalletId}
            onWalletIdChange={setCurrentWalletId}
            transactions={currentWalletTransactions}
          />
        )}

        {activeView === 'system-dashboard' && (
          <>
            <PolicePanel />
          </>
        )}
      </main>
    </div>
  );
}

export default App;

