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
}

export interface OverviewStats {
  total_transactions: number;
  blocked: number;
  flagged: number;
  approved: number;
  fraud_rate: number;
}

