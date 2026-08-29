import { injectable } from 'inversify';

// UC6: Parent Autopay Opt-Out & Operator Notice Controls.
// TODO: entirely unsupported by the current schema — no
// households.autopay_enabled flag exists (PRD: "a prominent,
// frictionless toggle... Automatic Payments (Autopay)"), and no
// notice-period config column exists on operators or households (PRD:
// "0 days notice vs. 14 days notice before the next billing cycle",
// global or per-household). No methods yet — routes call
// RouteHandlers.notImplemented directly until this schema exists.
@injectable()
export class AutopayServer {}
