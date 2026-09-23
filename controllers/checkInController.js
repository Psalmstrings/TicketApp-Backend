import { Ticket } from '../models/Ticket.js';
import { Event } from '../models/Event.js';
import { CheckIn } from '../models/CheckIn.js';
import { Notification } from '../models/Notification.js';
import { verifySecureQRToken } from '../services/qrService.js';
import { emitToEvent } from '../services/socketService.js';
import { logAudit } from '../services/auditService.js';

// @desc    Scan a QR code and check in a ticket
// @route   POST /api/checkin/scan
// @access  Private (Admin or Approved event organizer / staff)
export const scanQR = async (req, res) => {
  try {
    const { qrToken } = req.body;

    if (!qrToken) {
      return res.status(400).json({ success: false, message: 'QR token is required.' });
    }

    // ── Step 1: Verify the cryptographic signature on the QR token ──────────
    const verification = verifySecureQRToken(qrToken);
    if (!verification.valid) {
      // Still record an invalid scan attempt
      return res.status(400).json({
        success: false,
        code:    'INVALID_QR',
        message: `Invalid QR code: ${verification.error}`,
      });
    }

    // ── Step 2: Locate the ticket by its current stored qrToken ─────────────
    const ticket = await Ticket.findOne({ qrToken })
      .populate('eventId')
      .populate('ownerId', 'firstName lastName email phone')
      .populate('ticketTypeId', 'name section');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        code:    'TICKET_NOT_FOUND',
        message: 'Ticket not found. The QR code may have been invalidated (e.g. transferred or resold).',
      });
    }

    // ── Step 3: Check that the scanner is authorised for this event ─────────
    const event = ticket.eventId;
    const isAdmin      = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
    const isOrganizer  = event.organizerId.toString() === req.user._id.toString();

    if (!isAdmin && !isOrganizer) {
      return res.status(403).json({
        success: false,
        code:    'NOT_AUTHORIZED_FOR_EVENT',
        message: 'You are not authorised to check in tickets for this event.',
      });
    }

    // ── Step 4: Guard against duplicate check-in ─────────────────────────────
    if (ticket.checkedInAt) {
      // Record as a duplicate scan in the CheckIn collection for audit
      await CheckIn.create({
        ticketId:    ticket._id,
        eventId:     event._id,
        staffId:     req.user._id,
        checkInTime: new Date(),
        status:      'DUPLICATE',
        notes:       `Duplicate scan attempt. Original check-in: ${ticket.checkedInAt.toISOString()}`,
      });

      return res.status(409).json({
        success: false,
        code:    'ALREADY_CHECKED_IN',
        message: `This ticket was already checked in at ${ticket.checkedInAt.toLocaleString()}.`,
        data: {
          ticket: {
            ticketNumber: ticket.ticketNumber,
            section:      ticket.section,
            seat:         ticket.seat,
            checkedInAt:  ticket.checkedInAt,
          },
          event: {
            id:    event._id,
            title: event.title,
            venue: event.venue,
          },
        },
      });
    }

    // ── Step 5: Validate ticket status ───────────────────────────────────────
    if (ticket.status === 'CANCELLED' || ticket.status === 'REFUNDED') {
      await CheckIn.create({
        ticketId:    ticket._id,
        eventId:     event._id,
        staffId:     req.user._id,
        checkInTime: new Date(),
        status:      'INVALID',
        notes:       `Ticket status is ${ticket.status}`,
      });

      return res.status(400).json({
        success: false,
        code:    'TICKET_INVALID',
        message: `This ticket cannot be used: status is ${ticket.status}.`,
      });
    }

    // ── Step 6: Perform check-in ─────────────────────────────────────────────
    ticket.checkedInAt = new Date();
    ticket.checkedInBy = req.user._id;
    ticket.status      = 'USED';
    ticket.history.push({
      action:    'CHECKED_IN',
      toUser:    ticket.ownerId._id,
      timestamp: new Date(),
      notes:     `Checked in by ${req.user.firstName} ${req.user.lastName} at event "${event.title}"`,
    });
    await ticket.save();

    // Create CheckIn record
    const checkInRecord = await CheckIn.create({
      ticketId:    ticket._id,
      eventId:     event._id,
      staffId:     req.user._id,
      checkInTime: ticket.checkedInAt,
      status:      'VALID',
      notes:       `Valid check-in via QR scan`,
    });

    // Notify the ticket owner
    await Notification.create({
      userId:  ticket.ownerId._id,
      title:   'Ticket Checked In ✅',
      message: `Your ticket for "${event.title}" has been successfully scanned. Enjoy the event!`,
      type:    'CHECK_IN',
      data:    { ticketId: ticket._id, eventId: event._id },
    });

    // Broadcast real-time check-in update to event room
    emitToEvent(event._id, 'check_in', {
      ticketId:    ticket._id,
      ticketNumber: ticket.ticketNumber,
      section:     ticket.section,
      owner:       `${ticket.ownerId.firstName} ${ticket.ownerId.lastName}`,
      checkedInAt: ticket.checkedInAt,
    });

    await logAudit({
      actorId:    req.user._id,
      actorName:  `${req.user.firstName} ${req.user.lastName}`,
      actorRole:  req.user.role,
      action:     'TICKET_CHECKED_IN',
      targetType: 'TICKET',
      targetId:   ticket._id,
      details:    { eventId: event._id, ticketNumber: ticket.ticketNumber },
      req,
    });

    return res.json({
      success: true,
      code:    'CHECK_IN_SUCCESS',
      message: `Welcome! Ticket successfully checked in for "${event.title}".`,
      data: {
        checkIn: checkInRecord,
        ticket: {
          id:           ticket._id,
          ticketNumber: ticket.ticketNumber,
          section:      ticket.section,
          row:          ticket.row,
          seat:         ticket.seat,
          status:       ticket.status,
          checkedInAt:  ticket.checkedInAt,
          owner: {
            firstName: ticket.ownerId.firstName,
            lastName:  ticket.ownerId.lastName,
            email:     ticket.ownerId.email,
          },
          ticketType: ticket.ticketTypeId?.name || 'General',
        },
        event: {
          id:        event._id,
          title:     event.title,
          venue:     event.venue,
          startDate: event.startDate,
          startTime: event.startTime,
        },
      },
    });
  } catch (error) {
    console.error('[CheckIn scanQR Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all check-in records for an event
// @route   GET /api/checkin/event/:eventId
// @access  Private (Admin or the event organizer)
export const getEventCheckIns = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { page = 1, limit = 50, status = '' } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    // Authorization: admin or the event organizer
    const isAdmin     = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
    const isOrganizer = event.organizerId.toString() === req.user._id.toString();

    if (!isAdmin && !isOrganizer) {
      return res.status(403).json({
        success: false,
        message: 'Only admins or the event organizer can view check-in records.',
      });
    }

    const query = { eventId };
    if (status) query.status = status;

    const [checkIns, total] = await Promise.all([
      CheckIn.find(query)
        .populate({
          path:     'ticketId',
          select:   'ticketNumber section row seat ownerId',
          populate: { path: 'ownerId', select: 'firstName lastName email' },
        })
        .populate('staffId', 'firstName lastName email')
        .sort({ checkInTime: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10)),
      CheckIn.countDocuments(query),
    ]);

    // Summary stats
    const [validCount, duplicateCount, invalidCount] = await Promise.all([
      CheckIn.countDocuments({ eventId, status: 'VALID' }),
      CheckIn.countDocuments({ eventId, status: 'DUPLICATE' }),
      CheckIn.countDocuments({ eventId, status: 'INVALID' }),
    ]);

    return res.json({
      success: true,
      total,
      page:  parseInt(page, 10),
      pages: Math.ceil(total / parseInt(limit, 10)),
      summary: { validCount, duplicateCount, invalidCount },
      data:  checkIns,
    });
  } catch (error) {
    console.error('[CheckIn getEventCheckIns Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
