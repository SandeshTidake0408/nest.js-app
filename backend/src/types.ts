export type EventStatus = 'pending' | 'processing' | 'succeeded' | 'failed';

export interface WebhookData {
  orderId?: string;
  customerId?: string;
  simulate?: unknown;
  [key: string]: unknown;
}

export interface ClaimedEvent {
  event_id: string;
  type: string;
  data: WebhookData;
  attempt_count: number;
  attempt_number: number;
  lease_token: string;
}
