import express from 'express';
import { register, login, logout, getMe, updateMe } from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// @route   POST /api/auth/register
router.post('/register', register);

// @route   POST /api/auth/login
router.post('/login', login);

// @route   POST /api/auth/logout
router.post('/logout', logout);

// @route   GET /api/auth/me
router.get('/me', protect, getMe);

// @route   PUT /api/auth/me
router.put('/me', protect, updateMe);

export default router;
