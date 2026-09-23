import express from 'express';
import {
  getEvents,
  getEventById,
  createEvent,
  getOrganizerEvents,
  uploadEventMedia,
} from '../controllers/eventController.js';
import { protect, requireApproved } from '../middleware/authMiddleware.js';
import { upload } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// @route   GET  /api/events          — Public: list all published events
router.get('/', getEvents);

// @route   GET  /api/events/organizer/my-events  — Private: organizer's own events
router.get('/organizer/my-events', protect, getOrganizerEvents);

// @route   POST /api/events/upload   — Private (Approved): upload event media
router.post(
  '/upload',
  protect,
  requireApproved,
  upload.single('image'),
  uploadEventMedia
);

// @route   GET  /api/events/:id      — Public: single event by ID or slug
router.get('/:id', getEventById);

// @route   POST /api/events          — Private (Approved): create new event
router.post('/', protect, requireApproved, createEvent);

// @route   PUT  /api/events/:id      — Private (Approved): update event
// Reuse createEvent logic (controllers handle full replace) — or wire to dedicated updateEvent
// For now, we delegate to createEvent-style update; a dedicated updateEvent can be added later.
router.put('/:id', protect, requireApproved, createEvent);

// @route   DELETE /api/events/:id    — Private (Approved): soft-delete event
router.delete('/:id', protect, requireApproved, async (req, res) => {
  try {
    const { Event } = await import('../models/Event.js');
    const { logAudit } = await import('../services/auditService.js');

    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const isAdmin     = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
    const isOrganizer = event.organizerId.toString() === req.user._id.toString();

    if (!isAdmin && !isOrganizer) {
      return res.status(403).json({ success: false, message: 'Not authorised to delete this event.' });
    }

    event.status = 'SUSPENDED';
    await event.save();

    await logAudit({
      actorId:    req.user._id,
      actorName:  `${req.user.firstName} ${req.user.lastName}`,
      actorRole:  req.user.role,
      action:     'EVENT_DELETED',
      targetType: 'EVENT',
      targetId:   event._id,
      details:    { title: event.title },
      req,
    });

    return res.json({ success: true, message: 'Event removed successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
