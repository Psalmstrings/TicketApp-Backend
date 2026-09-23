import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { Notification } from '../models/Notification.js';
import { logAudit } from '../services/auditService.js';

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'tickapp_jwt_super_secret_key_2026_production', {
    expiresIn: '30d',
  });
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
export const register = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password, confirmPassword } = req.body;

    if (!firstName || !lastName || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Initial status MUST be PENDING
    const user = await User.create({
      firstName,
      lastName,
      email: email.toLowerCase(),
      phone,
      passwordHash,
      role: 'PENDING_USER',
      status: 'PENDING',
      balance: 0,
      avatar: {
        url: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(firstName + ' ' + lastName)}`,
        publicId: '',
      },
    });

    // Create welcoming notification
    await Notification.create({
      userId: user._id,
      title: 'Welcome to TickApp!',
      message: 'Your account has been created and is currently awaiting admin approval to create and transfer tickets.',
      type: 'ACCOUNT_CREATED',
    });

    await logAudit({
      actorId: user._id,
      actorName: `${firstName} ${lastName}`,
      actorRole: 'PENDING_USER',
      action: 'USER_REGISTERED',
      targetType: 'USER',
      targetId: user._id,
      req,
    });

    const token = generateToken(user._id);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully. Your account is awaiting admin approval.',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        avatar: user.avatar,
        balance: user.balance,
      },
    });
  } catch (error) {
    console.error('[Register Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase(), isDeleted: false });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (user.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_SUSPENDED',
        message: `Your account is suspended. Reason: ${user.suspensionReason || 'Contact support for assistance.'}`,
      });
    }

    const token = generateToken(user._id);

    return res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        avatar: user.avatar,
        balance: user.balance,
      },
    });
  } catch (error) {
    console.error('[Login Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.json({
      success: true,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        avatar: user.avatar,
        balance: user.balance,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Public
export const logout = async (req, res) => {
  return res.json({ success: true, message: 'Logged out successfully' });
};

// @desc    Update current user profile (name, phone)
// @route   PUT /api/auth/me
// @access  Private
export const updateMe = async (req, res) => {
  try {
    const { firstName, lastName, phone } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (firstName) user.firstName = firstName.trim();
    if (lastName) user.lastName = lastName.trim();
    if (phone) user.phone = phone.trim();
    await user.save();
    return res.json({
      success: true,
      message: 'Profile updated',
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        avatar: user.avatar,
        balance: user.balance,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
