import type { TransactionLogEntry, Decision } from '../types';

interface Props {
  transactions: TransactionLogEntry[];
}

const decisionClasses: Record<Decision, string> = {
  APPROVE: 'bg-approve/10 text-approve border-approve/40',
  FLAG: 'bg-flag/10 text-flag border-flag/40',
  BLOCK: 'bg-block/10 text-block border-block/40'
};

export const LiveTransactionsTable: React.FC<Props> = ({ transactions }) => {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Live Transaction Monitor</h2>
        <span className="text-xs text-slate-500">Most recent first</span>
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900/80 sticky top-0 z-10">
            <tr>
              <Th>ID</Th>
              <Th>User</Th>
              <Th>Amount</Th>
              <Th>Location</Th>
              <Th>Device</Th>
              <Th>Merchant</Th>
              <Th>Risk</Th>
              <Th>Decision</Th>
              <Th>Time</Th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id} className="border-t border-slate-800/80 hover:bg-slate-800/40">
                <Td className="font-mono text-xs text-slate-400">#{tx.id}</Td>
                <Td className="font-mono text-xs">{tx.user_id}</Td>
                <Td className="font-semibold text-slate-100">RM {tx.amount.toFixed(2)}</Td>
                <Td>{tx.location}</Td>
                <Td className="max-w-[120px] truncate" title={tx.device_id}>
                  {tx.device_id}
                </Td>
                <Td>{tx.merchant_id}</Td>
                <Td>{tx.risk_score.toFixed(2)}</Td>
                <Td>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${decisionClasses[tx.decision]}`}
                  >
                    {tx.decision}
                  </span>
                </Td>
                <Td className="text-xs text-slate-400">
                  {new Date(tx.timestamp).toLocaleTimeString(undefined, { hour12: false })}
                </Td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <Td colSpan={9} className="py-8 text-center text-slate-500">
                  No transactions yet. Invoke the `/check-transaction` API to see live activity.
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Th: React.FC<React.PropsWithChildren<{ className?: string }>> = ({ children, className }) => (
  <th className={`px-3 py-2 text-left text-xs font-semibold text-slate-400 ${className ?? ''}`}>{children}</th>
);

const Td: React.FC<React.PropsWithChildren<{ className?: string; colSpan?: number }>> = ({
  children,
  className,
  colSpan
}) => (
  <td className={`px-3 py-2 align-middle text-sm text-slate-200 ${className ?? ''}`} colSpan={colSpan}>
    {children}
  </td>
);

