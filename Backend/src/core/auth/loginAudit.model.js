import mongoose from 'mongoose';

/**
 * Login audit trail — one row per successful sign-in.
 *
 * Deliberately separate from food_refresh_tokens. That collection has an
 * `ipAddress` field and a TTL index: the field was never populated, and the TTL
 * deletes rows when the token expires, so it could never have served as a
 * record of who signed in and from where. An audit log that erases itself is
 * not an audit log.
 *
 * Rows are append-only and carry no token material, so this can be read by
 * anyone who can see the dashboard without exposing a credential.
 */
const loginAuditSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        role: { type: String, required: true, index: true },
        /** Snapshot, so the log still reads correctly after a rename or a delete. */
        name: { type: String, trim: true, default: '' },
        identifier: { type: String, trim: true, default: '' },
        ipAddress: { type: String, trim: true, default: '' },
        /** Raw User-Agent, kept alongside the parsed summary in case parsing is wrong. */
        userAgent: { type: String, trim: true, default: '' },
        /** "Desktop Win10 Chrome" — what the log actually shows. */
        systemDetails: { type: String, trim: true, default: '' },
        loginAt: { type: Date, default: Date.now, index: true }
    },
    { collection: 'food_login_audits', timestamps: false }
);

loginAuditSchema.index({ loginAt: -1 });
loginAuditSchema.index({ role: 1, loginAt: -1 });

export const FoodLoginAudit = mongoose.model('FoodLoginAudit', loginAuditSchema);
