import { useEffect, useMemo, useState } from 'react';
import type { CheckTransactionResult, PersistedTransaction, TransactionLogEntry, WalletUser } from '../types';
import { apiUrl } from '../api';
import { PhoneFrame } from './PhoneFrame';
import logo from '../image/image.png';

type Step = 'input' | 'review' | 'processing' | 'result';
type WalletTab = 'dashboard' | 'pay' | 'activity';

interface Props {
  walletId: string;
  onWalletIdChange: (id: string) => void;
  transactions: TransactionLogEntry[];
}

export const WalletView: React.FC<Props> = ({ walletId, onWalletIdChange, transactions }) => {
  const [tab, setTab] = useState<WalletTab>('dashboard');
  const [step, setStep] = useState<Step>('input');
  const [amount, setAmount] = useState<string>('120');
  const [receiver, setReceiver] = useState<string>('Merchant123');
  const [device, setDevice] = useState<string>('iPhone 15');
  const [deviceFingerprint, setDeviceFingerprint] = useState<string>('fp_demo_001');
  const [location, setLocation] = useState<string>('Johor Bahru');
  const [ipReputation, setIpReputation] = useState<string>('0.8');
  const [ipAddress, setIpAddress] = useState<string>('203.0.113.13');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<CheckTransactionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [todayHistory, setTodayHistory] = useState<PersistedTransaction[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [walletUser, setWalletUser] = useState<WalletUser | null>(null);
  const [availableBalance, setAvailableBalance] = useState<number>(1240.5);
  const currency = walletUser?.currency ?? 'RM';

  const receiverPresets = useMemo(
    () => [
      { id: 'Ali Mart', emoji: '🛒', subtitle: 'Grocery' },
      { id: 'ShopeePay', emoji: '🛍️', subtitle: 'Marketplace' },
      { id: 'Food Stall', emoji: '🍜', subtitle: 'Street vendor' },
      { id: 'Merchant123', emoji: '🏪', subtitle: 'Merchant' }
    ],
    []
  );

  const devicePresets = useMemo(
    () => [
      { id: 'iPhone 15', emoji: '📱' },
      { id: 'Android A34', emoji: '🤖' },
      { id: 'OPPO Reno', emoji: '📲' },
      { id: 'Redmi Note', emoji: '📳' }
    ],
    []
  );

  const fetchWalletUser = async () => {
    try {
      const res = await fetch(apiUrl(`/wallet/${encodeURIComponent(walletId)}`));
      if (!res.ok) throw new Error('wallet failed');
      const json = (await res.json()) as WalletUser;
      setWalletUser(json);
      setAvailableBalance(Number(json.balance ?? 0));
      // Make the UI feel consistent with the "saved" profile.
      if (json.primary_device) setDevice(json.primary_device);
      if (json.device_fingerprint) setDeviceFingerprint(json.device_fingerprint);
      if (json.location) setLocation(json.location);
    } catch {
      // If backend is down, keep local demo defaults.
      setWalletUser(null);
      setAvailableBalance(1240.5);
    }
  };

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
    fetchWalletUser();
    setTab('dashboard');
    setStep('input');
    setResult(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletId]);

  const createBody = () => {
    const now = new Date();
    const hh = now.getHours().toString().padStart(2, '0');
    const mm = now.getMinutes().toString().padStart(2, '0');

    return {
      user_id: walletId,
      amount: Number(amount),
      merchant_id: receiver,
      device_id: device,
      device_fingerprint: deviceFingerprint.trim() ? deviceFingerprint.trim() : null,
      location,
      time: `${hh}:${mm}`,
      ip_address: ipAddress.trim() ? ipAddress.trim() : null,
      ip_reputation: ipReputation.trim() ? Number(ipReputation) : null
    };
  };

  const runPayment = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const body = createBody();

      // For a real-time checkout flow, score first (no persistence),
      // then persist only if allowed (APPROVE/FLAG) so we don't disrupt UX.
      const scoreRes = await fetch(apiUrl('/risk/score'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!scoreRes.ok) {
        throw new Error('Risk score failed');
      }

      const scored = (await scoreRes.json()) as CheckTransactionResult;
      setResult(scored);

      // Persist to MongoDB ledger only if not BLOCKed (demo policy).
      if (scored.decision === 'BLOCK') {
        await refreshToday();
        return;
      }

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
      if (typeof json.balance_after === 'number') {
        setAvailableBalance(json.balance_after);
      } else {
        await fetchWalletUser();
      }
      await refreshToday();
    } catch (err) {
      setError('Failed to reach the backend – check that the FastAPI backend (and MongoDB for history) are running.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const startProcessing = async () => {
    setError(null);
    setResult(null);
    setStep('processing');
    await new Promise((r) => setTimeout(r, 1500));
    await runPayment();
    setStep('result');
  };

  const amountNumber = Number(amount || 0);
  const canReview = Number.isFinite(amountNumber) && amountNumber > 0 && receiver.trim().length > 0;

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
                <div className="flex items-center gap-2">
                  <img
                    src={logo}
                    alt="TrustGuard"
                    className="h-7 w-7 rounded-lg border border-slate-800 bg-white/5 object-contain"
                  />
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">TrustGuard Wallet</div>
                </div>
                <div className="text-sm font-semibold text-slate-100">
                  {tab === 'dashboard' && 'Dashboard'}
                  {tab === 'pay' && 'Send Money'}
                  {tab === 'activity' && 'Activity'}
                </div>
                <div className="text-[11px] text-slate-400">
                  {walletUser?.display_name ? `${walletUser.display_name} • Real-time fraud shield` : 'Real-time fraud shield for the unbanked'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-500">Wallet ID</div>
                <div className="font-mono text-[11px] text-slate-200">{walletId}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-800 bg-slate-950/40 p-2 text-[11px]">
              <button
                type="button"
                onClick={() => setTab('dashboard')}
                className={`h-9 rounded-xl ${
                  tab === 'dashboard' ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-900/60'
                }`}
              >
                Dashboard
              </button>
              <button
                type="button"
                onClick={() => setTab('pay')}
                className={`h-9 rounded-xl ${
                  tab === 'pay' ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-900/60'
                }`}
              >
                Pay
              </button>
              <button
                type="button"
                onClick={() => setTab('activity')}
                className={`h-9 rounded-xl ${
                  tab === 'activity' ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-900/60'
                }`}
              >
                Activity
              </button>
            </div>

            <div
              key={step}
              className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 transition-all duration-300"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] text-slate-500">Available balance</div>
                  <div className="text-xl font-bold text-slate-100">
                    {currency} {availableBalance.toFixed(2)}
                  </div>
                </div>
                {tab === 'pay' && (
                  <div className="text-right">
                    <div className="text-[10px] text-slate-500">Step</div>
                    <div className="text-[11px] text-slate-300">
                      {step === 'input' && '1/4'}
                      {step === 'review' && '2/4'}
                      {step === 'processing' && '3/4'}
                      {step === 'result' && '4/4'}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {tab === 'dashboard' && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">Profile</div>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <div className="text-slate-400">Device</div>
                      <div className="text-slate-200">{device}</div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-slate-400">Fingerprint</div>
                      <div className="font-mono text-slate-300 truncate max-w-[180px]">{deviceFingerprint}</div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-slate-400">Location</div>
                      <div className="text-slate-200">{location}</div>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setTab('pay');
                    setStep('input');
                  }}
                  className="w-full inline-flex items-center justify-center rounded-xl bg-sky-600 px-3 py-3 text-xs font-semibold text-white hover:bg-sky-500"
                >
                  Send money
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    await fetch(apiUrl(`/wallet/${encodeURIComponent(walletId)}/reset`), { method: 'POST' });
                    await fetchWalletUser();
                    await refreshToday();
                    setStep('input');
                    setResult(null);
                    setError(null);
                  }}
                  className="w-full inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-3 text-xs font-semibold text-slate-200 hover:bg-slate-800"
                >
                  Reset wallet (demo)
                </button>
              </div>
            )}

            {tab === 'pay' && step === 'input' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-slate-400">
                    Amount (RM)
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="mt-1 w-full h-10 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </label>
                  <div className="block text-slate-400">
                    Quick
                    <div className="mt-1 flex gap-2">
                      {[10, 50, 100].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setAmount(String(v))}
                          className="flex-1 h-10 rounded-xl border border-slate-700 bg-slate-900/60 text-[11px] text-slate-100 hover:bg-slate-800"
                        >
                          RM {v}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-slate-400">Select receiver</div>
                  <div className="grid grid-cols-2 gap-2">
                    {receiverPresets.map((p) => {
                      const active = receiver === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setReceiver(p.id)}
                          className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                            active
                              ? 'border-sky-500/70 bg-sky-500/10'
                              : 'border-slate-800 bg-slate-950/30 hover:bg-slate-900/60'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-center text-sm">
                              {p.emoji}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-slate-100 truncate">{p.id}</div>
                              <div className="text-[10px] text-slate-400">{p.subtitle}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <label className="block text-slate-400">
                    Or type receiver
                    <input
                      value={receiver}
                      onChange={(e) => setReceiver(e.target.value)}
                      className="mt-1 w-full h-10 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </label>
                </div>

                <details className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
                  <summary className="cursor-pointer select-none text-slate-300 text-[11px] font-semibold">
                    Optional security signals
                  </summary>
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
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
                      <label className="block text-slate-400">
                        IP address
                        <input
                          value={ipAddress}
                          onChange={(e) => setIpAddress(e.target.value)}
                          className="mt-1 w-full h-9 rounded-lg border border-slate-700 bg-slate-950/70 px-3 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                      </label>
                    </div>
                    <label className="block text-slate-400">
                      Device fingerprint
                      <input
                        value={deviceFingerprint}
                        onChange={(e) => setDeviceFingerprint(e.target.value)}
                        className="mt-1 w-full h-9 rounded-lg border border-slate-700 bg-slate-950/70 px-3 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                      />
                    </label>
                    <div className="space-y-2">
                      <div className="text-slate-400">Device (tap to switch)</div>
                      <div className="grid grid-cols-2 gap-2">
                        {devicePresets.map((d) => {
                          const active = device === d.id;
                          return (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => setDevice(d.id)}
                              className={`h-10 rounded-xl border px-3 text-[11px] text-left ${
                                active
                                  ? 'border-sky-500/70 bg-sky-500/10 text-slate-100'
                                  : 'border-slate-800 bg-slate-950/30 text-slate-300 hover:bg-slate-900/60'
                              }`}
                            >
                              <span className="mr-2" aria-hidden>
                                {d.emoji}
                              </span>
                              {d.id}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
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
                    </div>
                  </div>
                </details>

                <button
                  type="button"
                  disabled={!canReview}
                  onClick={() => setStep('review')}
                  className="w-full inline-flex items-center justify-center rounded-xl bg-sky-600 px-3 py-3 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
                >
                  Review payment
                </button>

                {error && <div className="text-[11px] text-amber-300">{error}</div>}
              </div>
            )}

            {tab === 'pay' && step === 'review' && (
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">Review payment</div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="text-slate-400">Send</div>
                      <div className="font-semibold text-slate-100">RM {Number(amount || 0).toFixed(2)}</div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-slate-400">To</div>
                      <div className="font-semibold text-slate-100">{receiver}</div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-slate-400">Device</div>
                      <div className="text-slate-200">{device}</div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-slate-400">Location</div>
                      <div className="text-slate-200">{location}</div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setStep('input')}
                    className="h-11 rounded-xl border border-slate-700 bg-slate-900/60 text-xs text-slate-200 hover:bg-slate-800"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={!canReview || isSubmitting}
                    onClick={startProcessing}
                    className="h-11 rounded-xl bg-sky-600 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
                  >
                    Confirm & Pay
                  </button>
                </div>

                {error && <div className="text-[11px] text-amber-300">{error}</div>}
              </div>
            )}

            {tab === 'pay' && step === 'processing' && (
              <div className="space-y-3 py-2">
                <div className="text-center">
                  <div className="animate-pulse text-sky-300 font-semibold">Processing payment…</div>
                  <div className="text-[11px] text-slate-500">Running fraud detection…</div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-[11px] text-slate-300 space-y-1">
                  <div className="text-slate-400 font-semibold mb-1">Security checks</div>
                  <div>✔ Checking device trust…</div>
                  <div>✔ Verifying location…</div>
                  <div>✔ Analyzing behavior pattern…</div>
                  <div>✔ Validating IP reputation…</div>
                </div>

                <div className="text-center text-[11px] text-slate-500">
                  Please keep this screen open.
                </div>
              </div>
            )}

            {tab === 'pay' && step === 'result' && (
              <div className="space-y-3">
                {error && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-200">
                    {error}
                  </div>
                )}

                {result ? (
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-center space-y-3">
                    <div className="text-lg font-bold text-slate-100">
                      {result.decision === 'APPROVE' && '✅ Payment Successful'}
                      {result.decision === 'FLAG' && '⚠️ Payment Flagged'}
                      {result.decision === 'BLOCK' && '❌ Payment Blocked'}
                    </div>

                    <div className="text-slate-200">
                      {currency} {Number(amount || 0).toFixed(2)} → {receiver}
                    </div>

                    <div className="text-xs text-slate-400">Risk Score: {result.risk_score.toFixed(2)}</div>
                    {typeof result.balance_before === 'number' && typeof result.balance_after === 'number' && (
                      <div className="text-[11px] text-slate-400">
                        Balance: {currency} {result.balance_before.toFixed(2)} →{' '}
                        <span className="text-slate-200">{currency} {result.balance_after.toFixed(2)}</span>
                      </div>
                    )}

                    <div className="w-full rounded-full bg-slate-800 h-2 overflow-hidden">
                      <div
                        className={`h-2 ${
                          result.decision === 'APPROVE'
                            ? 'bg-emerald-500'
                            : result.decision === 'FLAG'
                              ? 'bg-amber-500'
                              : 'bg-rose-500'
                        }`}
                        style={{ width: `${Math.max(2, Math.min(100, result.risk_score * 100))}%` }}
                      />
                    </div>

                    {result.reason && (
                      <div className="text-[11px] text-slate-300">
                        <span className="text-slate-400">Why:</span> {result.reason}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setStep('input')}
                        className="h-11 rounded-xl border border-slate-700 bg-slate-900/60 text-xs text-slate-200 hover:bg-slate-800"
                      >
                        New payment
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setStep('input');
                          setResult(null);
                          setError(null);
                          setTab('dashboard');
                        }}
                        className="h-11 rounded-xl bg-sky-600 text-xs font-semibold text-white hover:bg-sky-500"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-center text-slate-500">
                    No result yet.
                  </div>
                )}
              </div>
            )}

            {(tab === 'activity' || tab === 'dashboard') && (
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
              <div className={`${tab === 'activity' ? 'max-h-80' : 'max-h-52'} overflow-y-auto`}>
                <div className="space-y-2">
                  {mergedHistory.map((tx) => (
                    <div
                      key={tx.id}
                      className={`rounded-lg border border-slate-800 bg-slate-900/40 p-2 border-l-4 ${
                        tx.decision === 'APPROVE'
                          ? 'border-l-emerald-500/80'
                          : tx.decision === 'FLAG'
                            ? 'border-l-amber-500/80'
                            : 'border-l-rose-500/80'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-slate-200 font-semibold flex items-center gap-2">
                          <span aria-hidden>
                            {tx.decision === 'APPROVE' && '✅'}
                            {tx.decision === 'FLAG' && '⚠️'}
                            {tx.decision === 'BLOCK' && '❌'}
                          </span>
                          <span>RM {tx.amount.toFixed(2)}</span>
                        </div>
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
            )}
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

