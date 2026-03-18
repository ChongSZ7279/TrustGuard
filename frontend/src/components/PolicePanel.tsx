import { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../api';
import type { BlockedUserEntry, Decision, PersistedTransaction } from '../types';
import { decisionClasses } from './decisionStyles';
import { RiskCharts } from './RiskCharts';

type PoliceTx = PersistedTransaction & {
  tx_id: string;
  timestamp?: string;
};

export const PolicePanel: React.FC = () => {
  const [policeKey, setPoliceKey] = useState<string>('police-demo-key');
  const [blockUserId, setBlockUserId] = useState<string>('');
  const [blockReason, setBlockReason] = useState<string>('Confirmed fraud / mule account');
  const [blocked, setBlocked] = useState<BlockedUserEntry[]>([]);
  const [todayTx, setTodayTx] = useState<PoliceTx[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');
  const [decisionFilter, setDecisionFilter] = useState<Decision | 'ALL'>('ALL');
  const [minRisk, setMinRisk] = useState<number>(0.0);
  const [userIdFilter, setUserIdFilter] = useState<string>('');
  const [merchantFilter, setMerchantFilter] = useState<string>('');
  const [amountMin, setAmountMin] = useState<string>('');
  const [amountMax, setAmountMax] = useState<string>('');
  const [preset, setPreset] = useState<'CUSTOM' | 'HIGH_RISK' | 'NEW_DEVICES' | 'LARGE_TX'>('CUSTOM');
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(() => new Set());
  const [confirmBlockOpen, setConfirmBlockOpen] = useState<boolean>(false);
  const [pendingBlock, setPendingBlock] = useState<{ user_id: string; reason: string } | null>(null);
  const pageSize = 25;

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  const parseAmount = (v: string) => {
    if (!v || !v.trim()) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const headers = useMemo(
    () => ({
      'Content-Type': 'application/json',
      'X-Police-Key': policeKey
    }),
    [policeKey]
  );

  const refresh = async () => {
    setError(null);
    setIsLoading(true);
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
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Presets: keep simple & transparent. We only control filters that exist in the UI.
    if (preset === 'HIGH_RISK') {
      setMinRisk(0.8);
      setDecisionFilter('ALL');
    } else if (preset === 'LARGE_TX') {
      setAmountMin('500');
      setDecisionFilter('ALL');
    } else if (preset === 'NEW_DEVICES') {
      setQuery('new device');
    }
  }, [preset]);

  const resetFilters = () => {
    setPreset('CUSTOM');
    setQuery('');
    setUserIdFilter('');
    setMerchantFilter('');
    setAmountMin('');
    setAmountMax('');
    setDecisionFilter('ALL');
    setMinRisk(0);
    setPage(1);
  };

  const filteredTx = useMemo(() => {
    const q = query.trim().toLowerCase();
    const userQ = userIdFilter.trim().toLowerCase();
    const merchQ = merchantFilter.trim().toLowerCase();
    const minAmt = parseAmount(amountMin);
    const maxAmt = parseAmount(amountMax);
    const base = todayTx.filter((t) => {
      const matchesDecision = decisionFilter === 'ALL' ? true : t.decision === decisionFilter;
      const matchesRisk = Number(t.risk_score ?? 0) >= Number(minRisk ?? 0);
      if (!matchesDecision || !matchesRisk) return false;

      const amt = Number(t.amount ?? 0);
      if (minAmt !== null && amt < minAmt) return false;
      if (maxAmt !== null && amt > maxAmt) return false;

      if (userQ && !String(t.user_id ?? '').toLowerCase().includes(userQ)) return false;
      if (merchQ && !String(t.merchant_id ?? '').toLowerCase().includes(merchQ)) return false;

      if (!q) return true;
      return (
        String(t.user_id ?? '').toLowerCase().includes(q) ||
        String(t.device_id ?? '').toLowerCase().includes(q) ||
        String(t.location ?? '').toLowerCase().includes(q) ||
        String(t.merchant_id ?? '').toLowerCase().includes(q) ||
        String(t.tx_id ?? '').toLowerCase().includes(q) ||
        String(t.decision ?? '').toLowerCase().includes(q)
      );
    });
    return base;
  }, [todayTx, query, decisionFilter, minRisk, userIdFilter, merchantFilter, amountMin, amountMax]);

  const liveAlerts: PoliceTx[] = useMemo(() => {
    return [...todayTx]
      .sort((a, b) => Number(b.risk_score ?? 0) - Number(a.risk_score ?? 0))
      .filter((t) => (t.risk_score ?? 0) >= 0.8)
      .filter((t) => !dismissedAlertIds.has(String(t.tx_id)))
      .slice(0, 10);
  }, [todayTx, dismissedAlertIds]);

  const summary = useMemo(() => {
    const total = todayTx.length;
    const blockedCount = todayTx.filter((t) => t.decision === 'BLOCK').length;
    const flaggedCount = todayTx.filter((t) => t.decision === 'FLAG').length;
    const approvedCount = todayTx.filter((t) => t.decision === 'APPROVE').length;
    const highRisk = todayTx.filter((t) => Number(t.risk_score ?? 0) >= 0.8).length;
    return { total, blockedCount, flaggedCount, approvedCount, highRisk };
  }, [todayTx]);

  const riskBands = useMemo(() => {
    const low = todayTx.filter((t) => Number(t.risk_score ?? 0) < 0.3).length;
    const medium = todayTx.filter((t) => Number(t.risk_score ?? 0) >= 0.3 && Number(t.risk_score ?? 0) < 0.8).length;
    const high = todayTx.filter((t) => Number(t.risk_score ?? 0) >= 0.8).length;
    return { low, medium, high };
  }, [todayTx]);

  const riskBuckets = useMemo(() => {
    const buckets = 10;
    const counts = new Array(buckets).fill(0);
    for (const t of todayTx) {
      const r = clamp01(Number(t.risk_score ?? 0));
      const idx = Math.min(buckets - 1, Math.floor(r * buckets));
      counts[idx] += 1;
    }
    return counts;
  }, [todayTx]);

  useEffect(() => {
    setPage(1);
  }, [query, decisionFilter, minRisk, userIdFilter, merchantFilter, amountMin, amountMax]);

  const pagedTx = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredTx.slice(start, start + pageSize);
  }, [filteredTx, page]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(filteredTx.length / pageSize)), [filteredTx.length]);

  const selectedTx = useMemo(() => {
    if (!selectedTxId) return null;
    return todayTx.find((t) => String(t.tx_id) === String(selectedTxId)) ?? null;
  }, [todayTx, selectedTxId]);

  const openBlockConfirm = (user_id: string, reason: string) => {
    setPendingBlock({ user_id, reason });
    setConfirmBlockOpen(true);
  };

  const confirmBlock = async () => {
    if (!pendingBlock) return;
    setError(null);
    try {
      const res = await fetch(apiUrl('/police/block-user'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ user_id: pendingBlock.user_id, reason: pendingBlock.reason })
      });
      if (!res.ok) throw new Error('block failed');
      setBlockUserId('');
      setBlockReason('Confirmed fraud / mule account');
      setConfirmBlockOpen(false);
      setPendingBlock(null);
      await refresh();
    } catch {
      setError('Failed to block user (check key and backend).');
    }
  };

  return (
    <section className="space-y-6">
      {confirmBlockOpen && pendingBlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 shadow-xl">
            <div className="p-4 border-b border-slate-800">
              <div className="text-sm font-semibold text-slate-100">Confirm block user</div>
              <div className="mt-1 text-[11px] text-slate-400">
                This will force future transactions for this user to return <span className="text-block">BLOCK</span>.
              </div>
            </div>
            <div className="p-4 text-xs space-y-3">
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-slate-400">User</div>
                  <div className="font-mono text-slate-100">{pendingBlock.user_id}</div>
                </div>
                <div className="mt-2 text-slate-400">Reason</div>
                <div className="mt-1 text-[11px] text-slate-200 whitespace-pre-wrap">{pendingBlock.reason}</div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmBlockOpen(false);
                    setPendingBlock(null);
                  }}
                  className="h-9 rounded-md border border-slate-700 bg-slate-900/40 px-3 text-xs font-semibold text-slate-200 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmBlock}
                  className="h-9 rounded-md bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-500"
                >
                  Block user
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Police / Investigator Console</h2>
            <p className="text-slate-400">
              Today-only visibility by default (privacy-first). Triage high-risk activity, then block confirmed fraud.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              className="h-9 rounded-md bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
              disabled={isLoading}
            >
              {isLoading ? 'Refreshing…' : 'Refresh'}
            </button>
            <div className="rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">High risk</div>
              <div className="text-sm font-semibold text-rose-200">{summary.highRisk}</div>
            </div>
            <button
              type="button"
              onClick={resetFilters}
              className="h-9 rounded-md border border-slate-700 bg-slate-950/40 px-3 text-xs font-semibold text-slate-200 hover:bg-slate-800"
              title="Reset all filters"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-3">
          <label className="lg:col-span-3 text-slate-400">
            X-Police-Key
            <input
              className="mt-1 w-full h-9 rounded-md border border-slate-700 bg-slate-950/60 px-3 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
              value={policeKey}
              onChange={(e) => setPoliceKey(e.target.value)}
            />
          </label>

          <label className="lg:col-span-3 text-slate-400">
            Presets
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as any)}
              className="mt-1 w-full h-9 rounded-md border border-slate-700 bg-slate-950/60 px-3 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="CUSTOM">Custom</option>
              <option value="HIGH_RISK">High risk only (≥0.80)</option>
              <option value="LARGE_TX">Large transactions (≥500)</option>
              <option value="NEW_DEVICES">New devices (reason contains)</option>
            </select>
          </label>

          <label className="lg:col-span-3 text-slate-400">
            Quick search
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="any field… (user/device/location/merchant/tx_id)"
              className="mt-1 w-full h-9 rounded-md border border-slate-700 bg-slate-950/60 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </label>

          <label className="lg:col-span-2 text-slate-400">
            Decision
            <select
              value={decisionFilter}
              onChange={(e) => setDecisionFilter(e.target.value as Decision | 'ALL')}
              className="mt-1 w-full h-9 rounded-md border border-slate-700 bg-slate-950/60 px-3 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="ALL">All</option>
              <option value="APPROVE">Approve</option>
              <option value="FLAG">Flag</option>
              <option value="BLOCK">Block</option>
            </select>
          </label>

          <label className="lg:col-span-1 text-slate-400">
            Risk ≥ {minRisk.toFixed(2)}
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={clamp01(minRisk)}
              onChange={(e) => setMinRisk(clamp01(Number(e.target.value)))}
              className="mt-3 w-full accent-sky-500"
            />
          </label>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-slate-400">
            User ID
            <input
              value={userIdFilter}
              onChange={(e) => setUserIdFilter(e.target.value)}
              placeholder="e.g. user_001"
              className="mt-1 w-full h-9 rounded-md border border-slate-700 bg-slate-950/60 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </label>
          <label className="text-slate-400">
            Merchant
            <input
              value={merchantFilter}
              onChange={(e) => setMerchantFilter(e.target.value)}
              placeholder="e.g. Merchant123"
              className="mt-1 w-full h-9 rounded-md border border-slate-700 bg-slate-950/60 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </label>
          <label className="text-slate-400">
            Amount min
            <input
              value={amountMin}
              onChange={(e) => setAmountMin(e.target.value)}
              placeholder="e.g. 50"
              className="mt-1 w-full h-9 rounded-md border border-slate-700 bg-slate-950/60 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </label>
          <label className="text-slate-400">
            Amount max
            <input
              value={amountMax}
              onChange={(e) => setAmountMax(e.target.value)}
              placeholder="e.g. 2000"
              className="mt-1 w-full h-9 rounded-md border border-slate-700 bg-slate-950/60 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="text-[11px] text-slate-500 mr-1">Quick filters</div>
          <button
            type="button"
            onClick={() => {
              resetFilters();
            }}
            className="h-7 rounded-md border border-slate-700 bg-slate-950/40 px-2 text-[11px] text-slate-200 hover:bg-slate-800"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setDecisionFilter('BLOCK')}
            className="h-7 rounded-md border border-rose-700 bg-rose-950/30 px-2 text-[11px] font-semibold text-rose-200 hover:bg-rose-950/50"
          >
            Blocked
          </button>
          <button
            type="button"
            onClick={() => setDecisionFilter('FLAG')}
            className="h-7 rounded-md border border-amber-700 bg-amber-950/20 px-2 text-[11px] font-semibold text-amber-200 hover:bg-amber-950/35"
          >
            Flagged
          </button>
          <button
            type="button"
            onClick={() => {
              setMinRisk(0.8);
              setDecisionFilter('ALL');
            }}
            className="h-7 rounded-md border border-rose-700 bg-rose-950/30 px-2 text-[11px] font-semibold text-rose-200 hover:bg-rose-950/50"
          >
            High risk ≥ 0.80
          </button>

          <div className="ml-auto text-[11px] text-slate-500">
            Showing <span className="text-slate-200">{filteredTx.length}</span> matches
          </div>
        </div>

        {error && <div className="mt-3 text-[11px] text-amber-300">{error}</div>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => setDecisionFilter('ALL')}
          className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-left hover:bg-slate-900/80"
        >
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Today</div>
          <div className="mt-1 text-2xl font-semibold text-slate-100">{summary.total}</div>
          <div className="mt-1 text-[11px] text-slate-400">Total transactions</div>
        </button>
        <button
          type="button"
          onClick={() => setDecisionFilter('APPROVE')}
          className="rounded-xl border border-emerald-700/40 bg-emerald-900/10 p-4 text-left hover:bg-emerald-900/15"
        >
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Approved</div>
          <div className="mt-1 text-2xl font-semibold text-approve">{summary.approvedCount}</div>
          <div className="mt-1 text-[11px] text-slate-400">Low friction</div>
        </button>
        <button
          type="button"
          onClick={() => setDecisionFilter('FLAG')}
          className="rounded-xl border border-amber-700/60 bg-amber-900/10 p-4 text-left hover:bg-amber-900/15"
        >
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Flagged</div>
          <div className="mt-1 text-3xl font-semibold text-amber-200">{summary.flaggedCount}</div>
          <div className="mt-1 text-[11px] text-amber-200/70">Needs review</div>
        </button>
        <button
          type="button"
          onClick={() => setDecisionFilter('BLOCK')}
          className="rounded-xl border border-rose-600/70 bg-rose-900/15 p-4 text-left hover:bg-rose-900/20"
        >
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Blocked</div>
          <div className="mt-1 text-3xl font-semibold text-rose-200">{summary.blockedCount}</div>
          <div className="mt-1 text-[11px] text-rose-200/70">Prevent loss</div>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-1 space-y-6">
          <div className="sticky top-4">
            <div className="rounded-2xl border border-rose-500/70 bg-gradient-to-b from-rose-900/30 to-rose-950/30 p-4 shadow-lg shadow-rose-500/20">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-2.5 w-2.5 rounded-full bg-rose-400 animate-pulse" />
                  <h3 className="text-sm font-semibold text-rose-100">Live Monitoring</h3>
                </div>
                <div className="text-[11px] text-rose-200/70">risk ≥ 0.80</div>
              </div>

              <div className="mt-2 text-[11px] text-rose-200/80">
                Review alerts first. Click an alert to open the investigation panel.
              </div>

              <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
              {liveAlerts.map((t) => (
                <div
                  key={t.tx_id}
                  className={`w-full text-left p-2 rounded-xl border ${
                    String(selectedTxId) === String(t.tx_id)
                      ? 'border-rose-300 bg-rose-950/60'
                      : 'border-rose-700 bg-rose-950/40 hover:bg-rose-950/55'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTxId(String(t.tx_id));
                      setBlockUserId(String(t.user_id));
                      setBlockReason(t.reason ?? 'High risk activity detected');
                    }}
                    className="w-full text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-mono text-rose-100">{t.user_id}</div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-rose-200/80">RM {Number(t.amount ?? 0).toFixed(2)}</span>
                        <span className="font-mono text-rose-200/80">{Number(t.risk_score ?? 0).toFixed(2)}</span>
                      </div>
                    </div>
                    {t.reason && <div className="mt-1 text-[11px] text-rose-200/80 line-clamp-2">{t.reason}</div>}
                  </button>

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedTxId(String(t.tx_id))}
                      className="h-7 rounded-md bg-rose-600 px-2 text-[11px] font-semibold text-white hover:bg-rose-500"
                    >
                      Review alert
                    </button>
                    <button
                      type="button"
                      onClick={() => openBlockConfirm(String(t.user_id), t.reason ?? 'High risk activity detected')}
                      className="h-7 rounded-md border border-rose-400/60 bg-rose-950/20 px-2 text-[11px] font-semibold text-rose-100 hover:bg-rose-950/35"
                    >
                      Block now
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDismissedAlertIds((prev) => {
                          const next = new Set(prev);
                          next.add(String(t.tx_id));
                          return next;
                        })
                      }
                      className="ml-auto h-7 rounded-md border border-slate-700 bg-slate-950/30 px-2 text-[11px] text-slate-200 hover:bg-slate-800"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
              {liveAlerts.length === 0 && (
                <div className="text-[11px] text-slate-400">No high-risk alerts right now.</div>
              )}
            </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs">
            <h3 className="text-sm font-semibold text-slate-100 mb-1">Actions</h3>
            <p className="text-[11px] text-slate-400 mb-3">Block a confirmed fraud user. This takes effect immediately.</p>

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
                onClick={() => openBlockConfirm(blockUserId.trim(), blockReason)}
                disabled={!blockUserId.trim()}
                className="mt-1 h-10 rounded-md bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                Block user
              </button>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wide text-slate-400">Blocked users</div>
                <div className="text-[11px] text-slate-500">{blocked.length}</div>
              </div>
              <div className="mt-2 max-h-56 overflow-y-auto space-y-2">
                {blocked.map((b) => (
                  <div key={b.user_id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-slate-100">{b.user_id}</div>
                      <div className="text-[10px] text-slate-500">
                        {new Date(b.blocked_at).toLocaleString(undefined, { hour12: false })}
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-400 line-clamp-2" title={b.reason}>
                      {b.reason}
                    </div>
                  </div>
                ))}
                {blocked.length === 0 && <div className="text-slate-500 text-[11px]">No blocked users yet.</div>}
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Analytics</h3>
                <div className="text-[11px] text-slate-400">Risk zones + high risk threshold (0.80)</div>
              </div>
              <div className="text-right text-[11px] text-slate-400">
                High <span className="text-rose-200 font-semibold">{riskBands.high}</span> • Medium{' '}
                <span className="text-amber-200 font-semibold">{riskBands.medium}</span> • Low{' '}
                <span className="text-approve font-semibold">{riskBands.low}</span>
              </div>
            </div>

            <div className="mt-3">
              <div className="relative h-10 rounded-xl border border-slate-800 bg-slate-950/40 overflow-hidden">
                <div className="absolute inset-y-0 left-0 w-[30%] bg-emerald-500/10" />
                <div className="absolute inset-y-0 left-[30%] w-[50%] bg-amber-500/10" />
                <div className="absolute inset-y-0 left-[80%] w-[20%] bg-rose-500/15" />
                <div className="absolute inset-y-0 left-[80%] w-[2px] bg-rose-400/80" title="High risk threshold (0.80)" />
                <div className="absolute inset-0 flex items-center justify-between px-3 text-[11px] text-slate-300">
                  <div>Low</div>
                  <div className="text-slate-400">Medium</div>
                  <div className="text-rose-200 font-semibold">High</div>
                </div>
              </div>
            </div>
          </div>

          <div className="relative">
            <RiskCharts riskBuckets={riskBuckets} />
            <div
              className="pointer-events-none absolute top-12 bottom-5 w-[2px] bg-rose-400/70"
              style={{ left: '80%' }}
              title="High risk threshold (0.80)"
            />
            <div
              className="pointer-events-none absolute top-10 -translate-x-1/2 text-[10px] text-rose-200/80"
              style={{ left: '80%' }}
            >
              0.80
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Today’s transactions (MongoDB)</h3>
                <div className="text-[11px] text-slate-400">
                  Click a row to inspect reasons. Visibility is limited to today by policy.
                </div>
              </div>
              <div className="text-right text-[11px] text-slate-400">
                <div>
                  Showing <span className="text-slate-200">{pagedTx.length}</span> of{' '}
                  <span className="text-slate-200">{filteredTx.length}</span>
                </div>
                <div>
                  Page <span className="text-slate-200">{page}</span> /{' '}
                  <span className="text-slate-200">{pageCount}</span>
                </div>
              </div>
            </div>

            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-900/80 sticky top-0 z-10 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Time</th>
                    <th className="px-3 py-2 text-left">User</th>
                    <th className="px-3 py-2 text-left">Amount</th>
                    <th className="px-3 py-2 text-left">Merchant</th>
                    <th className="px-3 py-2 text-left">Decision</th>
                    <th className="px-3 py-2 text-left">Risk</th>
                    <th className="px-3 py-2 text-left">Why (short)</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedTx.map((t) => {
                    const isSelected = String(selectedTxId) === String(t.tx_id);
                    const tint =
                      t.decision === 'BLOCK'
                        ? 'bg-rose-950/25'
                        : t.decision === 'FLAG'
                          ? 'bg-amber-950/15'
                          : '';
                    return (
                      <tr
                        key={String(t.tx_id)}
                        className={`border-t border-slate-800/80 cursor-pointer ${tint} hover:bg-slate-800/40 ${
                          isSelected ? 'outline outline-1 outline-sky-500/60' : ''
                        }`}
                        onClick={() => setSelectedTxId(String(t.tx_id))}
                      >
                        <td className="px-3 py-2 text-slate-400 whitespace-nowrap sticky left-0 z-10 bg-slate-950/40">
                          {new Date(t.created_at ?? t.timestamp ?? new Date().toISOString()).toLocaleTimeString(
                            undefined,
                            { hour12: false }
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-200 whitespace-nowrap sticky left-[86px] z-10 bg-slate-950/40">
                          {t.user_id}
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-100 whitespace-nowrap sticky left-[190px] z-10 bg-slate-950/40">
                          RM {Number(t.amount ?? 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-slate-200 max-w-[180px] truncate" title={t.merchant_id}>
                          {t.merchant_id}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap sticky left-[310px] z-10 bg-slate-950/40">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                              decisionClasses[t.decision as Decision] ?? 'border-slate-700 text-slate-300'
                            }`}
                          >
                            {t.decision}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-200 whitespace-nowrap">
                          {Number(t.risk_score ?? 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 max-w-[280px] truncate text-[11px] text-slate-400" title={t.reason ?? ''}>
                          {t.reason ? t.reason : <span className="text-slate-600">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredTx.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                        No transactions match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-between gap-3 text-xs">
              <div className="text-[11px] text-slate-400">
                Tip: start with <span className="text-slate-200">Min risk = 0.80</span> to triage alerts faster.
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="h-8 rounded-md border border-slate-700 bg-slate-950/40 px-3 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page >= pageCount}
                  className="h-8 rounded-md border border-slate-700 bg-slate-950/40 px-3 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Investigation Panel</h3>
                <div className="text-[11px] text-slate-400">
                  Click a transaction to get a readable AI explanation + decision support.
                </div>
              </div>
              {selectedTx && (
                <button
                  type="button"
                  onClick={() => {
                    setBlockUserId(String(selectedTx.user_id));
                    setBlockReason(selectedTx.reason || 'Confirmed fraud / high risk activity');
                  }}
                  className="h-9 rounded-md bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-500"
                >
                  Pre-fill block action
                </button>
              )}
            </div>

            {!selectedTx && (
              <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-[11px] text-slate-400">
                No transaction selected.
              </div>
            )}

            {selectedTx && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Identity</div>
                  <div className="mt-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="text-slate-400">User</div>
                      <div className="font-mono text-slate-100">{selectedTx.user_id}</div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-slate-400">Device</div>
                      <div className="font-mono text-[11px] text-slate-200 truncate max-w-[220px]" title={selectedTx.device_id}>
                        {selectedTx.device_id}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-slate-400">Location</div>
                      <div className="text-slate-200">{selectedTx.location}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">Decision</div>
                  <div className="mt-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="text-slate-400">Tx</div>
                      <div className="font-mono text-[11px] text-slate-200">{selectedTx.tx_id}</div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-slate-400">Risk</div>
                      <div className="font-mono text-slate-100">{Number(selectedTx.risk_score ?? 0).toFixed(2)}</div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-slate-400">Decision</div>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                          decisionClasses[selectedTx.decision as Decision] ?? 'border-slate-700 text-slate-300'
                        }`}
                      >
                        {selectedTx.decision}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">AI explanation (decision support)</div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2 rounded-lg border border-slate-800 bg-slate-950/30 p-3">
                      <div className="text-[11px] text-slate-400 mb-2">Why {selectedTx.decision.toLowerCase()}?</div>
                      <ul className="space-y-1 text-[11px] text-slate-200">
                        {(selectedTx.reason || '—')
                          .split(';')
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .slice(0, 8)
                          .map((r, idx) => (
                            <li key={idx} className="flex gap-2">
                              <span className="mt-[2px] h-1.5 w-1.5 rounded-full bg-sky-400 flex-none" />
                              <span>{r}</span>
                            </li>
                          ))}
                      </ul>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-3">
                      <div className="text-[11px] text-slate-400">Confidence</div>
                      <div className="mt-1 font-mono text-2xl text-slate-100">
                        {Math.max(0, Math.min(1, Number(selectedTx.risk_score ?? 0))).toFixed(2)}
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-sky-500"
                          style={{ width: `${Math.max(0, Math.min(1, Number(selectedTx.risk_score ?? 0))) * 100}%` }}
                        />
                      </div>
                      <div className="mt-2 text-[10px] text-slate-500">
                        Proxy confidence = risk score in this prototype.
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-400">
                    <div className="rounded-md border border-slate-800 bg-slate-950/30 p-2">
                      <div className="text-slate-500">Amount</div>
                      <div className="font-mono text-slate-200">RM {Number(selectedTx.amount ?? 0).toFixed(2)}</div>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950/30 p-2">
                      <div className="text-slate-500">Merchant</div>
                      <div className="font-mono text-slate-200 truncate" title={selectedTx.merchant_id}>
                        {selectedTx.merchant_id}
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950/30 p-2">
                      <div className="text-slate-500">Latency</div>
                      <div className="font-mono text-slate-200">{Number(selectedTx.latency_ms ?? 0).toFixed(2)} ms</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

