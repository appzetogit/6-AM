import mongoose from 'mongoose';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { createOrder } from '../../orders/services/order.service.js';
import { FoodOrder } from '../../orders/models/order.model.js';

/**
 * Creates an order for a walk-in customer the seller enters manually in the
 * admin panel — reuses the full order-creation pipeline (pricing, stock,
 * coupons, ledger) so a POS sale is accounted for exactly like an app order,
 * just tagged with source: 'pos'. The customer is picked up in person, so
 * the restaurant's own address stands in for a delivery address.
 */
export async function createPosOrder(restaurantId, dto) {
    const restaurant = await FoodRestaurant.findById(restaurantId)
        .select('restaurantName ownerPhone primaryContactNumber addressLine1 addressLine2 area city state pincode location')
        .lean();
    if (!restaurant) throw new NotFoundError('Restaurant not found');

    const phone = String(dto.customerPhone || '').replace(/\D/g, '');
    if (!phone) throw new ValidationError('customerPhone is required');

    let customer = await FoodUser.findOne({ phone });
    if (!customer) {
        customer = await FoodUser.create({ phone, name: dto.customerName || 'Walk-in customer' });
    } else if (dto.customerName && !customer.name) {
        customer.name = dto.customerName;
        await customer.save();
    }

    const coords = restaurant.location?.coordinates;
    const address = {
        label: 'Other',
        name: restaurant.restaurantName,
        fullName: restaurant.restaurantName,
        street: restaurant.addressLine1 || restaurant.location?.addressLine1 || restaurant.restaurantName,
        additionalDetails: restaurant.addressLine2 || restaurant.location?.addressLine2 || '',
        city: restaurant.city || restaurant.location?.city || '',
        state: restaurant.state || restaurant.location?.state || '',
        zipCode: restaurant.pincode || restaurant.location?.pincode || '',
        phone: restaurant.ownerPhone || restaurant.primaryContactNumber || '',
        location: Array.isArray(coords) && coords.length === 2
            ? { type: 'Point', coordinates: coords }
            : undefined,
    };
    if (!address.location) {
        throw new ValidationError('This store has no saved location yet — set it up before taking POS orders');
    }

    const result = await createOrder(customer._id, {
        restaurantId: String(restaurantId),
        items: dto.items,
        address,
        paymentMethod: dto.paymentMethod || 'cash',
    });

    if (result?.order?._id) {
        await FoodOrder.updateOne({ _id: result.order._id }, { $set: { source: 'pos' } });
        result.order.source = 'pos';
    }

    return result;
}
