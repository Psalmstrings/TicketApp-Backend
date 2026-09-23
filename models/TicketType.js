import mongoose from 'mongoose';

const ticketTypeSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Ticket type name is required'],
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    price: {
      type: Number,
      required: true,
      default: 0,
    },
    quantity: {
      type: Number,
      required: true,
      default: 100,
    },
    availableQuantity: {
      type: Number,
      required: true,
      default: 100,
    },
    section: {
      type: String,
      default: 'General',
    },
    row: {
      type: String,
      default: '',
    },
    transferable: {
      type: Boolean,
      default: true,
    },
    resellable: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

export const TicketType = mongoose.model('TicketType', ticketTypeSchema);
