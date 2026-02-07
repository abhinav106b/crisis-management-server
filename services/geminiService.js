const { GoogleGenerativeAI } = require('@google/generative-ai');
const UrgencyScorer = require('./urgencyScorer');
require('dotenv').config();

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Get the model
const model = genAI.getGenerativeModel({ 
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
});

// Initialize urgency scorer
const urgencyScorer = new UrgencyScorer();

/**
 * Process crisis message and extract entities using Gemini API + Advanced Urgency Scoring
 * @param {string} message - The crisis message to process
 * @returns {Promise<Object>} Extracted entities and analysis
 */
async function processCrisisMessage(message) {
    const startTime = Date.now();
    
    try {
        const prompt = `You are an AI system for emergency crisis response. Analyze the following crisis message and extract key information.

CRISIS MESSAGE:
"${message}"

Extract and return ONLY a valid JSON object (no markdown, no explanation) with these fields:

{
    "need_type": "Type of need (medical, food, water, blankets, shelter, rescue, ambulance, clothing, or null if not clear)",
    "quantity": <number or null if not mentioned>,
    "quantity_unit": "Unit of quantity (units, people, families, liters, kg, etc.) or null",
    "location_text": "The location mentioned in the message or null",
    "location_city": "City name or null",
    "location_state": "State name (default to Karnataka if in Bangalore/Bengaluru area) or null",
    "key_factors": ["List", "of", "key", "factors", "from", "message"],
    "sentiment": "desperate, urgent, calm, informational"
}

IMPORTANT: Do NOT calculate urgency - that will be done by our specialized algorithm.
Just extract the facts from the message.

Return ONLY the JSON object, nothing else.`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        // Clean the response (remove markdown if present)
        let cleanedText = text.trim();
        if (cleanedText.startsWith('```json')) {
            cleanedText = cleanedText.replace(/```json\n?/, '').replace(/\n?```$/, '');
        } else if (cleanedText.startsWith('```')) {
            cleanedText = cleanedText.replace(/```\n?/, '').replace(/\n?```$/, '');
        }
        
        // Parse JSON
        const extracted = JSON.parse(cleanedText);
        
        // Use advanced urgency scoring algorithm
        const urgencyAnalysis = urgencyScorer.calculateUrgencyScore(extracted, message);
        
        // Combine extracted data with urgency analysis
        const finalResult = {
            ...extracted,
            urgency_score: urgencyAnalysis.score,
            urgency_level: urgencyAnalysis.level,
            urgency_reasoning: urgencyAnalysis.summary,
            urgency_breakdown: {
                factors: urgencyAnalysis.factors,
                reasoning: urgencyAnalysis.reasoning,
                recommendation: urgencyAnalysis.recommendation
            }
        };
        
        const processingTime = Date.now() - startTime;
        
        return {
            success: true,
            data: finalResult,
            processing_time_ms: processingTime,
            model_used: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
        };
        
    } catch (error) {
        console.error('Error processing crisis message with Gemini:', error);
        
        // Return fallback basic extraction if AI fails
        return {
            success: false,
            error: error.message,
            processing_time_ms: Date.now() - startTime,
            data: extractBasicEntitiesWithAdvancedScoring(message) // Fallback method
        };
    }
}

/**
 * Generate match reasoning using Gemini API
 * @param {Object} crisisRequest - Crisis request object
 * @param {Object} resource - Resource object
 * @param {Object} ngo - NGO object
 * @param {number} distance - Distance in km
 * @returns {Promise<Object>} Match reasoning and score
 */
async function generateMatchReasoning(crisisRequest, resource, ngo, distance) {
    try {
        const prompt = `You are an AI dispatcher for emergency response. Evaluate this resource match:

CRISIS REQUEST:
- Need: ${crisisRequest.need_type}
- Quantity: ${crisisRequest.quantity || 'Not specified'} ${crisisRequest.quantity_unit || ''}
- Location: ${crisisRequest.location_text || 'Not specified'}
- Urgency: ${crisisRequest.urgency_level} (${crisisRequest.urgency_score}/10)
- Message: "${crisisRequest.original_message}"

AVAILABLE RESOURCE:
- Resource: ${resource.resource_name}
- Type: ${resource.resource_type}
- Quantity Available: ${resource.quantity_available} ${resource.unit}
- NGO: ${ngo.ngo_name}
- Location: ${resource.location_city}, ${resource.location_state}
- Distance: ${distance.toFixed(1)} km
- Deployment Time: ${resource.deployment_time_hours} hours
- Coverage Radius: ${resource.coverage_radius_km} km
- Notes: ${resource.notes || 'None'}

Return ONLY a valid JSON object:
{
    "match_score": <number 0-100>,
    "reasoning": "Brief explanation of why this is a good/bad match (2-3 sentences)",
    "strengths": ["List of match strengths"],
    "concerns": ["List of concerns or limitations, empty array if none"]
}

SCORING CRITERIA:
- Resource type match: 40 points
- Distance proximity: 20 points (closer = better, within coverage = max points)
- Quantity sufficiency: 20 points
- Deployment speed: 10 points (faster for higher urgency)
- NGO reliability: 10 points

Return ONLY the JSON object.`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        let cleanedText = text.trim();
        if (cleanedText.startsWith('```json')) {
            cleanedText = cleanedText.replace(/```json\n?/, '').replace(/\n?```$/, '');
        } else if (cleanedText.startsWith('```')) {
            cleanedText = cleanedText.replace(/```\n?/, '').replace(/\n?```$/, '');
        }
        
        const matchAnalysis = JSON.parse(cleanedText);
        return matchAnalysis;
        
    } catch (error) {
        console.error('Error generating match reasoning:', error);
        
        // Fallback basic scoring
        return calculateBasicMatchScore(crisisRequest, resource, distance);
    }
}

/**
 * Fallback: Basic entity extraction using regex patterns with advanced urgency scoring
 */
function extractBasicEntitiesWithAdvancedScoring(message) {
    const messageLower = message.toLowerCase();
    
    const entities = {
        need_type: null,
        quantity: null,
        quantity_unit: null,
        location_text: null,
        location_city: null,
        location_state: null,
        key_factors: [],
        sentiment: 'informational'
    };
    
    // Extract need type
    const needPatterns = {
        'medical': /doctor|medical|medicine|health|hospital|ambulance|paramedic|emergency medical/i,
        'food': /food|meal|hungry|eat|ration|nutrition|starving/i,
        'water': /water|drink|thirst|dehydration/i,
        'blankets': /blanket|warm|cloth|bedding/i,
        'shelter': /shelter|tent|house|roof|accommodation|homeless/i,
        'rescue': /rescue|save|trapped|collapsed|stuck|buried/i,
        'ambulance': /ambulance/i
    };
    
    for (const [type, pattern] of Object.entries(needPatterns)) {
        if (pattern.test(message)) {
            entities.need_type = type;
            break;
        }
    }
    
    // Extract quantity
    const quantityMatch = message.match(/(\d+)\s*(people|person|families|family|unit|blanket|liter|kg|ton|packet)/i);
    if (quantityMatch) {
        entities.quantity = parseInt(quantityMatch[1]);
        entities.quantity_unit = quantityMatch[2];
    }
    
    // Extract location (Bangalore areas)
    const locationPatterns = [
        'jayanagar', 'mg road', 'koramangala', 'indiranagar', 'whitefield',
        'yelahanka', 'btm', 'hebbal', 'electronic city', 'marathahalli',
        'bangalore', 'bengaluru', 'hsr layout', 'banashankari', 'rajajinagar'
    ];
    
    for (const loc of locationPatterns) {
        if (messageLower.includes(loc)) {
            entities.location_text = loc;
            entities.location_city = loc.includes('bangalore') || loc.includes('bengaluru') ? 'Bangalore' : loc;
            entities.location_state = 'Karnataka';
            break;
        }
    }
    
    // Use advanced urgency scorer
    const urgencyAnalysis = urgencyScorer.calculateUrgencyScore(entities, message);
    
    return {
        ...entities,
        urgency_score: urgencyAnalysis.score,
        urgency_level: urgencyAnalysis.level,
        urgency_reasoning: urgencyAnalysis.summary,
        urgency_breakdown: {
            factors: urgencyAnalysis.factors,
            reasoning: urgencyAnalysis.reasoning,
            recommendation: urgencyAnalysis.recommendation
        }
    };
}

/**
 * Fallback: Basic entity extraction using regex patterns (DEPRECATED - use extractBasicEntitiesWithAdvancedScoring)
 */
function extractBasicEntities(message) {
    return extractBasicEntitiesWithAdvancedScoring(message);
}

/**
 * Fallback: Basic match scoring
 */
function calculateBasicMatchScore(crisisRequest, resource, distance) {
    let score = 0;
    const strengths = [];
    const concerns = [];
    
    // Type match (40 points)
    if (crisisRequest.need_type === resource.resource_type) {
        score += 40;
        strengths.push('Resource type matches the need');
    } else {
        concerns.push('Resource type does not match the requested need');
    }
    
    // Distance (20 points)
    if (distance < 5) {
        score += 20;
        strengths.push(`Very close proximity (${distance.toFixed(1)} km)`);
    } else if (distance < 10) {
        score += 15;
        strengths.push(`Nearby location (${distance.toFixed(1)} km)`);
    } else if (distance < 20) {
        score += 10;
        concerns.push(`Moderate distance (${distance.toFixed(1)} km)`);
    } else {
        score += 5;
        concerns.push(`Far distance (${distance.toFixed(1)} km)`);
    }
    
    // Quantity (20 points)
    if (crisisRequest.quantity && resource.quantity_available >= crisisRequest.quantity) {
        score += 20;
        strengths.push('Sufficient quantity available');
    } else if (crisisRequest.quantity) {
        score += 10;
        concerns.push('May not have sufficient quantity');
    } else {
        score += 15;
    }
    
    // Urgency alignment (10 points)
    if (crisisRequest.urgency_level === 'critical' && resource.deployment_time_hours <= 2) {
        score += 10;
        strengths.push('Quick deployment for critical urgency');
    } else {
        score += 5;
    }
    
    // Availability (10 points)
    if (resource.is_available) {
        score += 10;
        strengths.push('Resource is currently available');
    } else {
        concerns.push('Resource may not be immediately available');
    }
    
    const reasoning = concerns.length > 0 
        ? `Match score: ${score}/100. ${strengths.join('. ')}. However, ${concerns.join('. ')}.`
        : `Good match with score ${score}/100. ${strengths.join('. ')}.`;
    
    return {
        match_score: score,
        reasoning,
        strengths,
        concerns
    };
}

module.exports = {
    processCrisisMessage,
    generateMatchReasoning,
    extractBasicEntities,
    calculateBasicMatchScore
};
