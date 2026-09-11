import mongoose from 'mongoose';

const userAddressSchema = new mongoose.Schema(
    {
        label: {
            type: String,
            enum: ['Home', 'Office', 'Other'],
            default: 'Home',
            index: true
        },
        flatNumber: {
            type: String,
            default: '',
            trim: true
        },
        blockNumber: {
            type: String,
            default: '',
            trim: true
        },
        colonyName: {
            type: String,
            default: '',
            trim: true
        },
        street: {
            type: String,
            required: true,
            trim: true
        },
        additionalDetails: {
            type: String,
            default: '',
            trim: true
        },
        country: {
            type: String,
            trim: true,
            default: 'India'
        },
        city: {
            type: String,
            required: true,
            trim: true
        },
        state: {
            type: String,
            required: true,
            trim: true
        },
        zipCode: {
            type: String,
            default: '',
            trim: true
        },
        phone: {
            type: String,
            default: '',
            trim: true
        },
        location: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point'
            },
            coordinates: {
                // [lng, lat]
                type: [Number],
                default: undefined,
                validate: {
                    validator: (v) =>
                        v === undefined ||
                        (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))),
                    message: 'location.coordinates must be [lng, lat]'
                }
            }
        },
        isDefault: {
            type: Boolean,
            default: false,
            index: true
        }
    },
    { _id: true, timestamps: true }
);

const userSchema = new mongoose.Schema(
    {
        phone: {
            type: String,
            required: true,
            trim: true
        },
        countryCode: {
            type: String,
            default: '+91'
        },
        name: {
            type: String
        },
        email: {
            type: String
        },
        profileImage: {
            type: String,
            default: ''
        },
        fcmTokens: {
            type: [String],
            default: []
        },
        fcmTokenMobile: {
            type: [String],
            default: []
        },
        dateOfBirth: {
            type: Date,
            default: null
        },
        anniversary: {
            type: Date,
            default: null
        },
        gender: {
            type: String,
            enum: ['male', 'female', 'other', 'prefer-not-to-say', ''],
            default: ''
        },
        /**
         * WhatsApp number, when it differs from the one they sign in with.
         * Kept separate rather than assumed equal to `phone`: order updates go
         * to whichever the customer actually reads, and at a counter they are
         * often told two different numbers.
         */
        whatsappPhone: {
            type: String,
            trim: true,
            default: ''
        },
        whatsappCountryCode: {
            type: String,
            trim: true,
            default: '+91'
        },
        /**
         * GST standing, for a customer who buys against their business. An
         * unregistered buyer is the default and needs no GSTIN; a registered
         * one is invoiced with theirs on the bill.
         */
        gstType: {
            type: String,
            enum: ['unregistered', 'registered', 'composition'],
            default: 'unregistered'
        },
        gstin: {
            type: String,
            trim: true,
            uppercase: true,
            default: ''
        },
        referralCode: {
            type: String
        },
        referredBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodUser',
            default: null,
            index: true
        },
        referralCount: {
            type: Number,
            default: 0,
            min: 0
        },
        isVerified: {
            type: Boolean,
            default: false
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true
        },
        role: {
            type: String,
            default: 'USER'
        },
        addresses: {
            type: [userAddressSchema],
            default: []
        },
        /** Running average of ratings left by delivery partners. */
        rating: { type: Number, default: 0, min: 0, max: 5 },
        totalRatings: { type: Number, default: 0, min: 0 },
        /**
         * Bumped on every successful login, and embedded in the JWT that login
         * issues. A token whose version is behind the stored one is rejected, so
         * signing in on a new device silently invalidates every older device
         * rather than leaving the account live in two places at once.
         */
        tokenVersion: { type: Number, default: 0 }
    },
    {
        collection: 'food_users',
        timestamps: true
    }
);

/**
 * Drops a location that has no position before it reaches the index.
 *
 * `location.type` defaults to 'Point', so an address saved without
 * coordinates — a counter customer whose address was typed, not picked off a
 * map — arrives as `{ type: 'Point' }` with nothing in it, and the 2dsphere
 * index refuses the whole document: "Can't extract geo keys". The address is
 * legitimate; only the half-built Point is not, so it goes rather than the
 * save failing. An address with no pin reads back with no location at all,
 * which is exactly how the rows written before coordinates existed look.
 */
userSchema.pre('validate', function dropEmptyAddressPoints(next) {
    for (const address of this.addresses || []) {
        const coords = address?.location?.coordinates;
        if (!Array.isArray(coords) || coords.length !== 2) {
            address.set('location', undefined);
        }
    }
    next();
});

userSchema.index({ phone: 1 }, { unique: true });
userSchema.index({ 'addresses.location': '2dsphere' });

export const FoodUser = mongoose.model('FoodUser', userSchema);

