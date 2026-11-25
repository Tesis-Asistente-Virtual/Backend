export interface ReferralEmail {
  readonly recipient: string;
  readonly subject?: string;
  readonly bodyText: string;
}

export interface ReferralMailer {
  send(email: ReferralEmail): Promise<{ readonly messageId: string }>;
}

export type ReferralSmtpFailureStage =
  | 'tls_connect' | 'server_greeting' | 'ehlo' | 'authentication' | 'mail_from'
  | 'recipient' | 'data_command' | 'data_submission' | 'data_acceptance' | 'quit';

export interface ReferralMailerDiagnostics {
  readonly stage: ReferralSmtpFailureStage;
  readonly smtpCode?: number;
  readonly failureCode?: 'timeout' | 'transport_error' | 'invalid_request' | 'invalid_smtp_response' | 'smtp_rejected';
  readonly durationMs: number;
  readonly acceptanceUncertain: boolean;
}

export class ReferralMailerError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'delivery_unknown',
    readonly diagnostics?: ReferralMailerDiagnostics,
  ) {
    super('Referral email delivery failed');
    this.name = 'ReferralMailerError';
  }
}
