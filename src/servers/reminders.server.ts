import { injectable } from 'inversify';

// UC5: Automated Payment Reminders & Consolidated Invoicing.
// TODO: entirely unsupported by the current schema — no table for
// reminder-timeline config, dunning-retry state, or broadcast
// delivery-receipt tracking exists yet (PRD: "7 days before due, 1 day
// before due", 3-day dunning retry sequence, bounced-email/phone
// tracking for broadcasts). No methods yet — routes call
// RouteHandlers.notImplemented directly until this schema exists.
@injectable()
export class RemindersServer {}
