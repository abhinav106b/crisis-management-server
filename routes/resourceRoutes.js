const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

/**
 * @route   GET /api/resources
 * @desc    Get all resources with filters
 * @access  Private
 */
router.get('/', authenticateToken, async (req, res) => {
    const { resource_type, state, city, available = 'true', limit = 50, offset = 0 } = req.query;
    
    try {
        let query = `
            SELECT 
                r.*,
                n.ngo_name,
                n.darpan_id,
                n.phone as ngo_phone,
                n.email as ngo_email
            FROM resources r
            INNER JOIN ngos n ON r.ngo_id = n.id
            WHERE n.is_active = true
        `;
        
        const params = [];
        
        if (available === 'true') {
            query += ' AND r.is_available = true';
        }
        
        if (resource_type) {
            params.push(resource_type);
            query += ` AND r.resource_type = $${params.length}`;
        }
        
        if (state) {
            params.push(state);
            query += ` AND r.location_state = $${params.length}`;
        }
        
        if (city) {
            params.push(city);
            query += ` AND r.location_city = $${params.length}`;
        }
        
        query += ` ORDER BY r.quantity_available DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(parseInt(limit), parseInt(offset));
        
        const result = await db.query(query, params);
        
        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length
        });
        
    } catch (error) {
        console.error('Error getting resources:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve resources',
            error: error.message
        });
    }
});

/**
 * @route   GET /api/resources/:id
 * @desc    Get single resource by ID
 * @access  Private
 */
router.get('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    
    try {
        const query = `
            SELECT 
                r.*,
                n.ngo_name,
                n.darpan_id,
                n.phone as ngo_phone,
                n.email as ngo_email,
                n.state as ngo_state,
                n.district as ngo_district
            FROM resources r
            INNER JOIN ngos n ON r.ngo_id = n.id
            WHERE r.id = $1
        `;
        
        const result = await db.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Resource not found'
            });
        }
        
        res.json({
            success: true,
            data: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error getting resource:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve resource',
            error: error.message
        });
    }
});

module.exports = router;
