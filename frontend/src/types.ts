export type Decision = 'APPROVE' | 'FLAG' | 'BLOCK';

export interface TransactionLogEntry {
  id: number;
  user_id: string;
  amount: number;
  location: string;
  device_id: string;
  merchant_id: string;
  decision: Decision;
  risk_score: number;
  timestamp: string;
  ledger_hash?: string;
  ledger_index?: number;
  registry_tx_hash?: string;
}

export interface OverviewStats {
  total_transactions: number;
  blocked: number;
  flagged: number;
  approved: number;
  fraud_rate: number;
}

export interface CheckTransactionResult {
  decision: Decision;
  risk_score: number;
  reason?: string;
  latency_ms?: number;
  tx_id?: string;
  ledger_hash?: string;
  ledger_index?: number;
  ledger_prev_hash?: string;
  registry_tx_hash?: string;
  model_loaded?: boolean;
  balance_before?: number;
  balance_after?: number;
  id?: number;
  user_id?: string;
  amount?: number;
  merchant_id?: string;
  location?: string;
  device_id?: string;
  timestamp?: string;
}

export interface PersistedTransaction {
  tx_id: string;
  user_id: string;
  amount: number;
  location: string;
  device_id: string;
  merchant_id: string;
  time_str: string;
  ip_reputation?: number | null;
  decision: Decision;
  risk_score: number;
  reason: string;
  latency_ms: number;
  created_at: string;
  ledger_hash?: string;
  ledger_index?: number;
  ledger_prev_hash?: string;
  registry_tx_hash?: string;
}

export interface BlockedUserEntry {
  user_id: string;
  reason: string;
  blocked_at: string;
  blocked_by: string;
}

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface PoliceTicket {
  ticket_id: string;
  tx_id: string;
  user_id: string;
  device_id: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigned_to: string;
  notes: string;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export interface RelatedTransactionsResponse {
  seed: { tx_id: string; user_id?: string; device_id?: string };
  links: {
    user_id?: string;
    device_id?: string;
    ip_hash?: string | null;
    device_fingerprint_hash?: string | null;
    ledger_hash?: string | null;
    registry_tx_hash?: string | null;
  };
  related: any[];
}

export interface WalletUser {
  user_id: string;
  display_name: string;
  balance: number;
  currency: string;
  primary_device: string;
  device_fingerprint: string;
  location: string;
  updated_at: string;
}


