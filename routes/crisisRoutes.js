const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
    createCrisisRequest,
    getAllCrisisRequests,
    getCrisisRequestById,
    updateCrisisRequestStatus
} = require('../controllers/crisisController');
const { authenticateToken, isDispatcher } = require('../middleware/auth');

/**
 * @route   POST /api/crisis
 * @desc    Create new crisis request
 * @access  Private (Dispatcher)
 */
router.post('/', [
    authenticateToken,
    isDispatcher,
    body('original_message').notEmpty().trim()
], createCrisisRequest);

/**
 * @route   GET /api/crisis
 * @desc    Get all crisis requests with filters
 * @access  Private (Dispatcher)
 */
router.get('/', authenticateToken, isDispatcher, getAllCrisisRequests);

/**
 * @route   GET /api/crisis/:id
 * @desc    Get single crisis request by ID
 * @access  Private (Dispatcher)
 */
router.get('/:id', authenticateToken, isDispatcher, getCrisisRequestById);

/**
 * @route   PUT /api/crisis/:id/status
 * @desc    Update crisis request status
 * @access  Private (Dispatcher)
 */
router.put('/:id/status', [
    authenticateToken,
    isDispatcher,
    body('status').isIn(['pending', 'matched', 'dispatched', 'completed', 'cancelled'])
], updateCrisisRequestStatus);

module.exports = router;
