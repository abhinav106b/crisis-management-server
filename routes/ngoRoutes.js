const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

/**
 * @route   GET /api/ngos
 * @desc    Get all NGOs with filters
 * @access  Private
 */
router.get('/', authenticateToken, async (req, res) => {
    const { state, district, sector, limit = 50, offset = 0 } = req.query;
    
    try {
        let query = 'SELECT * FROM ngos WHERE is_active = true';
        const params = [];
        
        if (state) {
            params.push(state);
            query += ` AND state = $${params.length}`;
        }
        
        if (district) {
            params.push(district);
            query += ` AND district = $${params.length}`;
        }
        
        if (sector) {
            params.push(sector);
            query += ` AND $${params.length} = ANY(sectors)`;
        }
        
        query += ` ORDER BY ngo_name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(parseInt(limit), parseInt(offset));
        
        const result = await db.query(query, params);
        
        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length
        });
        
    } catch (error) {
        console.error('Error getting NGOs:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve NGOs',
            error: error.message
        });
    }
});

/**
 * @route   GET /api/ngos/:id
 * @desc    Get single NGO by ID
 * @access  Private
 */
router.get('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    
    try {
        const ngoQuery = 'SELECT * FROM ngos WHERE id = $1';
        const ngoResult = await db.query(ngoQuery, [id]);
        
        if (ngoResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'NGO not found'
            });
        }
        
        // Get associated resources
        const resourcesQuery = 'SELECT * FROM resources WHERE ngo_id = $1 AND is_available = true';
        const resourcesResult = await db.query(resourcesQuery, [id]);
        
        res.json({
            success: true,
            data: {
                ngo: ngoResult.rows[0],
                resources: resourcesResult.rows
            }
        });
        
    } catch (error) {
        console.error('Error getting NGO:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve NGO',
            error: error.message
        });
    }
});

module.exports = router;
