import { Event } from '../models/Event.js';
import { TicketType } from '../models/TicketType.js';
import { processUpload } from '../middleware/uploadMiddleware.js';
import { logAudit } from '../services/auditService.js';

// @desc    Get all published events
// @route   GET /api/events
// @access  Public
export const getEvents = async (req, res) => {
  try {
    const { search, category, featured } = req.query;
    const query = { status: 'PUBLISHED' };

    if (category && category !== 'All') {
      query.category = category;
    }

    if (featured === 'true') {
      query.featured = true;
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { venue: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const events = await Event.find(query)
      .populate('organizerId', 'firstName lastName')
      .sort({ startDate: 1 });

    return res.json({ success: true, count: events.length, data: events });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get single event by ID or slug
// @route   GET /api/events/:id
// @access  Public
export const getEventById = async (req, res) => {
  try {
    const { id } = req.params;
    let event = null;

    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      event = await Event.findById(id).populate('organizerId', 'firstName lastName email');
    } else {
      event = await Event.findOne({ slug: id }).populate('organizerId', 'firstName lastName email');
    }

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const ticketTypes = await TicketType.find({ eventId: event._id });

    return res.json({
      success: true,
      data: {
        ...event.toObject(),
        ticketTypes,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a new event manually
// @route   POST /api/events
// @access  Private (Approved user or Admin only)
export const createEvent = async (req, res) => {
  try {
    // CRITICAL BACKEND CHECK
    if (req.user.status !== 'APPROVED' && req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_APPROVAL_REQUIRED',
        message: 'Your account must be approved by an administrator before you can create events.',
      });
    }

    const {
      title,
      description,
      category,
      venue,
      entranceInfo,
      address,
      latitude,
      longitude,
      startDate,
      startTime,
      endDate,
      endTime,
      doorsOpen,
      timeAnnounced,
      multiDay,
      countdownEnabled,
      coverImageUrl,
      seatMapUrl,
      ticketTypes,
      status,
    } = req.body;

    if (!title || !startDate || !venue) {
      return res.status(400).json({ success: false, message: 'Title, start date, and venue are required.' });
    }

    const coverImage = coverImageUrl
      ? { url: coverImageUrl, publicId: 'manual_upload' }
      : {
          url: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&auto=format&fit=crop&q=80',
          publicId: 'default_cover',
        };

    const seatMap = seatMapUrl ? { url: seatMapUrl, publicId: 'seatmap' } : null;

    const event = await Event.create({
      organizerId: req.user._id,
      title,
      description: description || '',
      category: category || 'Music',
      coverImage,
      seatMap,
      venue,
      entranceInfo: entranceInfo || '',
      address: address || '',
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      startDate: new Date(startDate),
      startTime: startTime || '20:00',
      endDate: endDate ? new Date(endDate) : null,
      endTime: endTime || '',
      doorsOpen: doorsOpen || '',
      timeAnnounced: timeAnnounced !== undefined ? Boolean(timeAnnounced) : true,
      multiDay: Boolean(multiDay),
      countdownEnabled: countdownEnabled !== undefined ? Boolean(countdownEnabled) : true,
      status: status || 'PUBLISHED',
    });

    // Create ticket types if provided
    let createdTicketTypes = [];
    if (ticketTypes && Array.isArray(ticketTypes) && ticketTypes.length > 0) {
      const typesToInsert = ticketTypes.map((tt) => ({
        eventId: event._id,
        name: tt.name || 'General Admission',
        description: tt.description || '',
        price: tt.price !== undefined ? parseFloat(tt.price) : 0,
        quantity: tt.quantity ? parseInt(tt.quantity, 10) : 100,
        availableQuantity: tt.quantity ? parseInt(tt.quantity, 10) : 100,
        section: tt.section || 'General',
        transferable: tt.transferable !== undefined ? Boolean(tt.transferable) : true,
        resellable: tt.resellable !== undefined ? Boolean(tt.resellable) : true,
      }));
      createdTicketTypes = await TicketType.insertMany(typesToInsert);
    } else {
      // Default ticket type
      const defaultType = await TicketType.create({
        eventId: event._id,
        name: 'General Admission',
        description: 'Standard admission ticket',
        price: 0,
        quantity: 200,
        availableQuantity: 200,
        section: 'GA',
        transferable: true,
        resellable: true,
      });
      createdTicketTypes.push(defaultType);
    }

    await logAudit({
      actorId: req.user._id,
      actorName: `${req.user.firstName} ${req.user.lastName}`,
      actorRole: req.user.role,
      action: 'EVENT_CREATED',
      targetType: 'EVENT',
      targetId: event._id,
      details: { title: event.title, venue: event.venue },
      req,
    });

    return res.status(201).json({
      success: true,
      message: 'Event created successfully',
      data: {
        ...event.toObject(),
        ticketTypes: createdTicketTypes,
      },
    });
  } catch (error) {
    console.error('[Create Event Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get current organizer's events
// @route   GET /api/events/organizer/my-events
// @access  Private (Approved)
export const getOrganizerEvents = async (req, res) => {
  try {
    const events = await Event.find({ organizerId: req.user._id }).sort({ createdAt: -1 });
    return res.json({ success: true, count: events.length, data: events });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Upload media for event (banner / seat map)
// @route   POST /api/events/upload
// @access  Private (Approved user or Admin)
export const uploadEventMedia = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file uploaded' });
    }
    const uploadedData = await processUpload(req.file, 'tickapp/events');
    return res.json({
      success: true,
      data: uploadedData,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
