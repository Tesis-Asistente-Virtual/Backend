export class ReferralFeatureUnavailable extends Error { constructor() { super('Psychological referral is unavailable'); this.name = 'ReferralFeatureUnavailable'; } }
export class ReferralConsentRequired extends Error { constructor() { super('Current psychological referral consent is required'); this.name = 'ReferralConsentRequired'; } }
export class ReferralNotFound extends Error { constructor() { super('Psychological referral was not found'); this.name = 'ReferralNotFound'; } }
export class ReferralSourceUnavailable extends Error { constructor() { super('Source analysis is unavailable'); this.name = 'ReferralSourceUnavailable'; } }
export class ReferralStateConflict extends Error { constructor() { super('Psychological referral state conflicts with the requested operation'); this.name = 'ReferralStateConflict'; } }
export class ReferralConfirmationInvalid extends Error { constructor() { super('Explicit confirmation does not match the current preview'); this.name = 'ReferralConfirmationInvalid'; } }
export class ReferralDeliveryUnavailable extends Error { constructor(readonly kind: 'unavailable' | 'delivery_unknown') { super('Psychological referral delivery failed'); this.name = 'ReferralDeliveryUnavailable'; } }
