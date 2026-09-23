import crypto from 'crypto';
import { Order } from '../models/Order.js';
import { Ticket } from '../models/Ticket.js';
import { TicketType } from '../models/TicketType.js';
import { Event } from '../models/Event.js';
import { Notification } from '../models/Notification.js';
import { generateSecureQRToken } from '../services/qrService.js';
import { emitToUser } from '../services/socketService.js';
import { logAudit } from '../services/auditService.js';

// @desc    Place a free ticket order (instant fulfillment)
// @route   POST /api/orders
// @access  Private (Any authenticated active user)
export const createOrder = async (req, res) => {
  try {
    const { eventId, ticketTypeId, quantity = 1 } = req.body;

    if (!eventId || !ticketTypeId) {
      return res.status(400).json({ success: false, message: 'Event ID and ticket type are required.' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const ticketType = await TicketType.findById(ticketTypeId);
    if (!ticketType) {
      return res.status(404).json({ success: false, message: 'Ticket type not found' });
    }

    const numQty = parseInt(quantity, 10) || 1;
    if (ticketType.availableQuantity < numQty) {
      return res.status(400).json({
        success: false,
        message: `Only ${ticketType.availableQuantity} tickets remaining.`,
      });
    }

    const orderNumber = `ORD-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    // Create Order with zero fee / free checkout
    const order = await Order.create({
      userId: req.user._id,
      orderNumber,
      totalAmount: 0,
      status: 'PAID',
      paymentMethod: 'FREE_CHECKOUT',
      items: [
        {
          ticketTypeId: ticketType._id,
          eventId: event._id,
          quantity: numQty,
          unitPrice: 0,
          totalPrice: 0,
        },
      ],
    });

    // Deduct ticket inventory
    ticketType.availableQuantity -= numQty;
    await ticketType.save();

    // Issue individual tickets to the user
    const issuedTickets = [];
    for (let i = 0; i < numQty; i++) {
      const ticketNumber = `TICK-${Date.now().toString().slice(-5)}${i}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const tempId = crypto.randomBytes(12).toString('hex');
      const qrToken = generateSecureQRToken(tempId, event._id, req.user._id);

      const ticket = await Ticket.create({
        eventId: event._id,
        ticketTypeId: ticketType._id,
        orderId: order._id,
        ownerId: req.user._id,
        ticketNumber,
        section: ticketType.section || 'General',
        row: ticketType.row || 'GA',
        seat: `Open-${i + 1}`,
        price: 0,
        qrToken,
        status: 'SOLD',
        transferable: ticketType.transferable,
        resellable: ticketType.resellable,
        history: [
          {
            action: 'ISSUED',
            toUser: req.user._id,
            notes: `Purchased via order ${orderNumber}`,
          },
        ],
      });
      issuedTickets.push(ticket);
    }

    // Create notification
    await Notification.create({
      userId: req.user._id,
      title: 'Tickets Confirmed! 🎉',
      message: `You have successfully claimed ${numQty} ticket(s) for "${event.title}". View them in My Tickets.`,
      type: 'TICKET_PURCHASED',
      data: { orderId: order._id, eventId: event._id },
    });

    emitToUser(req.user._id, 'notification', {
      title: 'Tickets Confirmed!',
      message: `Claimed ${numQty} ticket(s) for ${event.title}`,
    });

    await logAudit({
      actorId: req.user._id,
      actorName: `${req.user.firstName} ${req.user.lastName}`,
      actorRole: req.user.role,
      action: 'ORDER_PLACED',
      targetType: 'ORDER',
      targetId: order._id,
      details: { orderNumber, count: numQty, event: event.title },
      req,
    });

    return res.status(201).json({
      success: true,
      message: 'Tickets claimed successfully!',
      data: {
        order,
        tickets: issuedTickets,
      },
    });
  } catch (error) {
    console.error('[Order Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get current user's orders
// @route   GET /api/orders/my-orders
// @access  Private
export const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user._id })
      .populate('items.eventId')
      .populate('items.ticketTypeId')
      .sort({ createdAt: -1 });

    return res.json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
