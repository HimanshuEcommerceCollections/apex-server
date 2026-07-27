export interface PaymentIntentResult {
  payment_id: string;
  payment_intent_id: string;
  client_secret: string | null;
  amount: number;
  currency: string;
  publishable_key: string | null;
}

export interface WebhookResult {
  handled: boolean;
  reason?: string;
}

export interface RefundResult {
  payment_id: string;
  refunded_amount: number;
  status: string;
}
