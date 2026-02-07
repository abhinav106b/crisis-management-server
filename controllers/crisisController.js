const db = require('../config/database');
const { processCrisisMessage, generateMatchReasoning } = require('../services/geminiService');

/**
 * Create a new crisis request and process it with AI
 */
const createCrisisRequest = async (req, res) => {
    const { original_message, message_source } = req.body;
    const user_id = req.user.id;
    
    if (!original_message || original_message.trim() === '') {
        return res.status(400).json({
            success: false,
            message: 'Crisis message is required'
        });
    }
    
    try {
        // Process message with Gemini AI
        const aiResult = await processCrisisMessage(original_message);
        
        if (!aiResult.success) {
            console.warn('AI processing failed, using fallback extraction');
        }
        
        const extracted = aiResult.data;

        // Coerce numeric fields to integers to match DB column types
        const quantityInt = (extracted.quantity !== undefined && extracted.quantity !== null)
            ? (Number.isFinite(Number(extracted.quantity)) ? parseInt(Number(extracted.quantity)) : null)
            : null;

        let urgencyScoreInt = null;
        if (extracted.urgency_score !== undefined && extracted.urgency_score !== null) {
            const num = Number(extracted.urgency_score);
            if (Number.isFinite(num)) {
                // Round to nearest integer and clamp between 0 and 10
                urgencyScoreInt = Math.min(10, Math.max(0, Math.round(num)));
            }
        }
        
        // Insert crisis request into database
        const insertQuery = `
            INSERT INTO crisis_requests (
                user_id, original_message, message_source,
                need_type, quantity, quantity_unit,
                location_text, location_state, location_city,
                urgency_score, urgency_level, urgency_reasoning,
                ai_processed, ai_response, processing_time_ms,
                status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING *
        `;
        
        const values = [
            user_id,
            original_message,
            message_source || 'Manual',
            extracted.need_type,
            quantityInt,
            extracted.quantity_unit,
            extracted.location_text,
            extracted.location_state,
            extracted.location_city,
            urgencyScoreInt,
            extracted.urgency_level,
            extracted.urgency_reasoning,
            aiResult.success,
            JSON.stringify(aiResult),
            aiResult.processing_time_ms,
            'pending'
        ];
        
        const result = await db.query(insertQuery, values);
        const crisisRequest = result.rows[0];
        
        // Find matching resources from LIVE database
        console.log('🔍 Searching live database for matching resources...');
        const matches = await findMatchingResources(crisisRequest);
        console.log(`✓ Found ${matches.length} matching resources in database`);
        
        res.status(201).json({
            success: true,
            message: 'Crisis request created and processed successfully',
            data: {
                crisis_request: crisisRequest,
                extracted_entities: extracted,
                urgency_breakdown: extracted.urgency_breakdown || null, // Detailed urgency analysis
                matches: matches,
                processing_time_ms: aiResult.processing_time_ms,
                database_stats: {
                    total_matches_found: matches.length,
                    search_completed_at: new Date().toISOString()
                }
            }
        });
        
    } catch (error) {
        console.error('Error creating crisis request:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create crisis request',
            error: error.message
        });
    }
};

/**
 * Find matching resources for a crisis request
 */
const findMatchingResources = async (crisisRequest) => {
    try {
        // Query resources that match the need type
        let resourceQuery = `
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
            WHERE r.is_available = true
            AND n.is_active = true
        `;
        
        const queryParams = [];
        
        // Filter by resource type if specified
        if (crisisRequest.need_type) {
            queryParams.push(crisisRequest.need_type);
            resourceQuery += ` AND r.resource_type = $${queryParams.length}`;
        }
        
        // Filter by state if specified
        if (crisisRequest.location_state) {
            queryParams.push(crisisRequest.location_state);
            resourceQuery += ` AND r.location_state = $${queryParams.length}`;
        }
        
        resourceQuery += ` ORDER BY r.quantity_available DESC LIMIT 20`;
        
        const resourcesResult = await db.query(resourceQuery, queryParams);
        const resources = resourcesResult.rows;
        
        if (resources.length === 0) {
            return [];
        }
        
        // Calculate match scores for each resource
        const matches = [];
        
        for (const resource of resources) {
            // Calculate distance (simplified - in production use proper geospatial queries)
            const distance = calculateDistance(
                crisisRequest.latitude,
                crisisRequest.longitude,
                resource.latitude,
                resource.longitude
            ) || 999; // Default large distance if coordinates missing
            
            // Generate match reasoning with AI
            const ngo = {
                ngo_name: resource.ngo_name,
                darpan_id: resource.darpan_id
            };
            
            const matchAnalysis = await generateMatchReasoning(
                crisisRequest,
                resource,
                ngo,
                distance
            );
            
            // Check various match factors
            const locationMatch = crisisRequest.location_city && 
                                  resource.location_city && 
                                  crisisRequest.location_city.toLowerCase() === resource.location_city.toLowerCase();
            
            const quantitySufficient = !crisisRequest.quantity || 
                                       resource.quantity_available >= crisisRequest.quantity;
            
            const urgencyAligned = (
                (crisisRequest.urgency_level === 'critical' && resource.deployment_time_hours <= 2) ||
                (crisisRequest.urgency_level === 'high' && resource.deployment_time_hours <= 4) ||
                crisisRequest.urgency_level === 'medium' ||
                crisisRequest.urgency_level === 'low'
            );
            
            matches.push({
                resource_id: resource.id,
                ngo_id: resource.ngo_id,
                ngo_name: resource.ngo_name,
                resource_name: resource.resource_name,
                resource_type: resource.resource_type,
                quantity_available: resource.quantity_available,
                unit: resource.unit,
                location: `${resource.location_city}, ${resource.location_state}`,
                distance_km: distance,
                contact_phone: resource.contact_phone,
                contact_person: resource.contact_person,
                deployment_time_hours: resource.deployment_time_hours,
                match_score: matchAnalysis.match_score,
                reasoning: matchAnalysis.reasoning,
                strengths: matchAnalysis.strengths,
                concerns: matchAnalysis.concerns,
                location_match: locationMatch,
                quantity_sufficient: quantitySufficient,
                urgency_aligned: urgencyAligned
            });
        }
        
        // Sort by match score
        matches.sort((a, b) => b.match_score - a.match_score);
        
        // Return top 5 matches
        return matches.slice(0, 5);
        
    } catch (error) {
        console.error('Error finding matching resources:', error);
        return [];
    }
};

/**
 * Calculate distance between two coordinates (Haversine formula)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    
    const R = 6371; // Earth's radius in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return distance;
}

function toRad(degrees) {
    return degrees * (Math.PI / 180);
}

/**
 * Get all crisis requests with filters
 */
const getAllCrisisRequests = async (req, res) => {
    const { status, urgency_level, need_type, limit = 50, offset = 0 } = req.query;
    
    try {
        let query = `
            SELECT 
                cr.*,
                u.full_name as created_by_name,
                u.email as created_by_email
            FROM crisis_requests cr
            LEFT JOIN users u ON cr.user_id = u.id
            WHERE 1=1
        `;
        
        const queryParams = [];
        
        if (status) {
            queryParams.push(status);
            query += ` AND cr.status = $${queryParams.length}`;
        }
        
        if (urgency_level) {
            queryParams.push(urgency_level);
            query += ` AND cr.urgency_level = $${queryParams.length}`;
        }
        
        if (need_type) {
            queryParams.push(need_type);
            query += ` AND cr.need_type = $${queryParams.length}`;
        }
        
        query += ` ORDER BY cr.created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
        queryParams.push(parseInt(limit), parseInt(offset));
        
        const result = await db.query(query, queryParams);
        
        // Get total count
        let countQuery = 'SELECT COUNT(*) FROM crisis_requests WHERE 1=1';
        const countParams = [];
        
        if (status) {
            countParams.push(status);
            countQuery += ` AND status = $${countParams.length}`;
        }
        if (urgency_level) {
            countParams.push(urgency_level);
            countQuery += ` AND urgency_level = $${countParams.length}`;
        }
        if (need_type) {
            countParams.push(need_type);
            countQuery += ` AND need_type = $${countParams.length}`;
        }
        
        const countResult = await db.query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].count);
        
        res.json({
            success: true,
            data: result.rows,
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset),
                pages: Math.ceil(total / limit)
            }
        });
        
    } catch (error) {
        console.error('Error getting crisis requests:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve crisis requests',
            error: error.message
        });
    }
};

/**
 * Get single crisis request by ID with matches
 */
const getCrisisRequestById = async (req, res) => {
    const { id } = req.params;
    
    try {
        // Get crisis request
        const requestQuery = `
            SELECT 
                cr.*,
                u.full_name as created_by_name,
                u.email as created_by_email
            FROM crisis_requests cr
            LEFT JOIN users u ON cr.user_id = u.id
            WHERE cr.id = $1
        `;
        
        const requestResult = await db.query(requestQuery, [id]);
        
        if (requestResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Crisis request not found'
            });
        }
        
        const crisisRequest = requestResult.rows[0];
        
        // Get associated matches
        const matchesQuery = `
            SELECT 
                m.*,
                r.resource_name,
                r.resource_type,
                r.quantity_available,
                r.unit,
                r.location_city,
                r.location_state,
                r.contact_phone,
                r.contact_person,
                n.ngo_name,
                n.darpan_id,
                n.phone as ngo_phone,
                n.email as ngo_email
            FROM matches m
            INNER JOIN resources r ON m.resource_id = r.id
            INNER JOIN ngos n ON m.ngo_id = n.id
            WHERE m.crisis_request_id = $1
            ORDER BY m.match_score DESC
        `;
        
        const matchesResult = await db.query(matchesQuery, [id]);
        
        res.json({
            success: true,
            data: {
                crisis_request: crisisRequest,
                matches: matchesResult.rows
            }
        });
        
    } catch (error) {
        console.error('Error getting crisis request:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve crisis request',
            error: error.message
        });
    }
};

/**
 * Update crisis request status
 */
const updateCrisisRequestStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    const validStatuses = ['pending', 'matched', 'dispatched', 'completed', 'cancelled'];
    
    if (!validStatuses.includes(status)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid status value'
        });
    }
    
    try {
        const query = `
            UPDATE crisis_requests 
            SET status = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
        `;
        
        const result = await db.query(query, [status, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Crisis request not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Crisis request status updated successfully',
            data: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error updating crisis request:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update crisis request',
            error: error.message
        });
    }
};

module.exports = {
    createCrisisRequest,
    getAllCrisisRequests,
    getCrisisRequestById,
    updateCrisisRequestStatus,
    findMatchingResources
};
