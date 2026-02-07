/**
 * Advanced Urgency Scoring System
 * 
 * This module calculates urgency scores (0-10) for crisis requests using a multi-factor
 * weighted algorithm with transparent reasoning generation.
 * 
 * SCORING FRAMEWORK:
 * - Score Range: 0-10 (floating point for precision)
 * - 9-10: CRITICAL - Life-threatening, immediate response required
 * - 7-8.9: HIGH - Serious situation, urgent response needed
 * - 5-6.9: MEDIUM - Important but not immediately life-threatening
 * - 3-4.9: LOW - Non-urgent, standard response timeline
 * - 0-2.9: MINIMAL - Informational or preventive
 */

class UrgencyScorer {
    constructor() {
        // Weight distribution for different factors (total = 100%)
        this.weights = {
            medical_severity: 0.35,      // 35% - Medical emergencies are top priority
            vulnerability: 0.20,         // 20% - Children, elderly, pregnant, disabled
            time_sensitivity: 0.15,      // 15% - How quickly help is needed
            scale: 0.15,                 // 15% - Number of people affected
            environmental_factors: 0.10, // 10% - Weather, temperature, conditions
            resource_availability: 0.05  // 5% - How common/rare the needed resource is
        };
        
        // Factor calculation methods
        this.factorCalculators = {
            medical_severity: this.calculateMedicalSeverity.bind(this),
            vulnerability: this.calculateVulnerability.bind(this),
            time_sensitivity: this.calculateTimeSensitivity.bind(this),
            scale: this.calculateScale.bind(this),
            environmental_factors: this.calculateEnvironmentalFactors.bind(this),
            resource_availability: this.calculateResourceAvailability.bind(this)
        };
    }

    /**
     * Main scoring function
     * @param {Object} extractedData - Data from Gemini AI extraction
     * @param {string} originalMessage - Original crisis message
     * @returns {Object} Score with detailed breakdown
     */
    calculateUrgencyScore(extractedData, originalMessage) {
        const messageLower = originalMessage.toLowerCase();
        const factors = {};
        const reasoning = [];
        let totalScore = 0;

        // Calculate each factor
        for (const [factorName, calculator] of Object.entries(this.factorCalculators)) {
            const result = calculator(extractedData, messageLower);
            factors[factorName] = {
                score: result.score,
                weight: this.weights[factorName],
                weightedScore: result.score * this.weights[factorName],
                reasoning: result.reasoning,
                indicators: result.indicators || []
            };
            
            totalScore += factors[factorName].weightedScore;
            
            if (result.score > 0) {
                reasoning.push({
                    factor: this.formatFactorName(factorName),
                    impact: this.getImpactLevel(result.score),
                    explanation: result.reasoning,
                    indicators: result.indicators || []
                });
            }
        }

        // Apply multipliers for extreme situations
        const multipliers = this.calculateMultipliers(extractedData, messageLower);
        totalScore *= multipliers.multiplier;
        
        if (multipliers.applied.length > 0) {
            reasoning.push({
                factor: "Critical Multipliers",
                impact: "CRITICAL",
                explanation: multipliers.reasoning,
                indicators: multipliers.applied
            });
        }

        // Normalize to 0-10 range
        totalScore = Math.min(10, Math.max(0, totalScore));

        // Determine urgency level
        const urgencyLevel = this.getUrgencyLevel(totalScore);

        return {
            score: parseFloat(totalScore.toFixed(2)),
            level: urgencyLevel,
            factors: factors,
            reasoning: reasoning,
            summary: this.generateSummary(totalScore, reasoning),
            recommendation: this.generateRecommendation(urgencyLevel, extractedData)
        };
    }

    /**
     * FACTOR 1: Medical Severity (35% weight)
     * Evaluates the medical urgency of the situation
     */
    calculateMedicalSeverity(data, message) {
        let score = 0;
        const indicators = [];
        
        // Critical medical emergencies (Score: 10)
        const criticalMedical = [
            { pattern: /heart attack|cardiac arrest|myocardial infarction/i, label: "Heart attack" },
            { pattern: /stroke|brain hemorrhage|cerebral/i, label: "Stroke" },
            { pattern: /severe bleeding|hemorrhag(e|ing)|massive blood loss/i, label: "Severe bleeding" },
            { pattern: /not breathing|stopped breathing|respiratory failure/i, label: "Respiratory failure" },
            { pattern: /unconscious|unresponsive|coma/i, label: "Unconscious patient" },
            { pattern: /seizure|convuls/i, label: "Seizure" },
            { pattern: /anaphylaxis|severe allergic reaction/i, label: "Anaphylaxis" },
            { pattern: /drowning|submersion/i, label: "Drowning" }
        ];

        for (const critical of criticalMedical) {
            if (critical.pattern.test(message)) {
                score = 10;
                indicators.push(critical.label);
            }
        }

        // Severe medical situations (Score: 8-9)
        if (score === 0) {
            const severeMedical = [
                { pattern: /severe pain|excruciating|agonizing/i, label: "Severe pain" },
                { pattern: /broken bone|fracture/i, label: "Fracture" },
                { pattern: /severe injury|trauma/i, label: "Severe trauma" },
                { pattern: /diabetic emergency|insulin shock/i, label: "Diabetic emergency" },
                { pattern: /poisoning|toxic/i, label: "Poisoning" },
                { pattern: /burn(s|ed|ing)|scalded/i, label: "Burns" }
            ];

            for (const severe of severeMedical) {
                if (severe.pattern.test(message)) {
                    score = 8.5;
                    indicators.push(severe.label);
                    break;
                }
            }
        }

        // Medical need without immediate life threat (Score: 5-7)
        if (score === 0 && data.need_type === 'medical') {
            const moderateMedical = [
                { pattern: /doctor|physician|medical help/i, label: "Medical assistance needed", score: 6 },
                { pattern: /medicine|medication|prescription/i, label: "Medication needed", score: 5 },
                { pattern: /ambulance/i, label: "Ambulance requested", score: 7 }
            ];

            for (const moderate of moderateMedical) {
                if (moderate.pattern.test(message)) {
                    score = moderate.score;
                    indicators.push(moderate.label);
                    break;
                }
            }
        }

        // Check for medical keywords with urgency indicators
        if (/emergency|urgent|critical/i.test(message) && data.need_type === 'medical') {
            score = Math.max(score, 7);
            indicators.push("Medical emergency declared");
        }

        const reasoning = score > 0 
            ? `Medical severity scored ${score}/10 due to: ${indicators.join(', ')}`
            : "No immediate medical emergency detected";

        return { score, reasoning, indicators };
    }

    /**
     * FACTOR 2: Vulnerability (20% weight)
     * Assesses vulnerable populations involved
     */
    calculateVulnerability(data, message) {
        let score = 0;
        const indicators = [];

        // Vulnerable populations
        const vulnerableGroups = [
            { pattern: /child|children|kid|baby|infant|toddler/i, label: "Children involved", points: 3 },
            { pattern: /elderly|senior|old age|geriatric/i, label: "Elderly involved", points: 2.5 },
            { pattern: /pregnant|expecting|maternity/i, label: "Pregnant women", points: 3 },
            { pattern: /disabled|handicapped|special needs/i, label: "Disabled persons", points: 2.5 },
            { pattern: /orphan|unaccompanied minor/i, label: "Orphans/unaccompanied minors", points: 3.5 },
            { pattern: /chronic illness|terminally ill/i, label: "Chronically ill", points: 2.5 },
            { pattern: /refugee|displaced/i, label: "Refugees/displaced", points: 2 }
        ];

        for (const group of vulnerableGroups) {
            if (group.pattern.test(message)) {
                score += group.points;
                indicators.push(group.label);
            }
        }

        // Multiple vulnerable groups multiply the concern
        if (indicators.length > 1) {
            score *= 1.2;
            indicators.push(`Multiple vulnerable groups (${indicators.length})`);
        }

        score = Math.min(10, score);

        const reasoning = indicators.length > 0
            ? `Vulnerability score: ${score.toFixed(1)}/10 - ${indicators.join(', ')}`
            : "No specific vulnerable populations identified";

        return { score, reasoning, indicators };
    }

    /**
     * FACTOR 3: Time Sensitivity (15% weight)
     * Evaluates how quickly response is needed
     */
    calculateTimeSensitivity(data, message) {
        let score = 5; // Default moderate urgency
        const indicators = [];

        // Extreme urgency indicators (Score: 10)
        const extremeUrgency = [
            { pattern: /NOW|IMMEDIATELY|ASAP|RIGHT NOW/i, label: "Immediate action required" },
            { pattern: /emergency|911|urgent|critical/i, label: "Emergency declared" },
            { pattern: /life.{0,10}death|dying|critical condition/i, label: "Life-threatening situation" }
        ];

        for (const urgent of extremeUrgency) {
            if (urgent.pattern.test(message)) {
                score = 10;
                indicators.push(urgent.label);
                break;
            }
        }

        // High urgency (Score: 7-8)
        if (score === 5) {
            const highUrgency = [
                { pattern: /today|tonight|this (morning|evening|afternoon)/i, label: "Same-day need" },
                { pattern: /within.{0,5}hour/i, label: "Needed within hours" },
                { pattern: /running out|almost gone|depleted/i, label: "Resources depleting" }
            ];

            for (const high of highUrgency) {
                if (high.pattern.test(message)) {
                    score = 7.5;
                    indicators.push(high.label);
                    break;
                }
            }
        }

        // Time-based degradation (situations getting worse)
        const timePatterns = [
            { pattern: /(\d+)\s*day/i, label: "days", multiplier: 1.3 },
            { pattern: /(\d+)\s*hour/i, label: "hours", multiplier: 1.5 },
            { pattern: /since (yesterday|last night)/i, label: "since yesterday", multiplier: 1.2 }
        ];

        for (const timePattern of timePatterns) {
            const match = message.match(timePattern.pattern);
            if (match) {
                score = Math.min(10, score * timePattern.multiplier);
                indicators.push(`Situation ongoing for ${match[1] || ''} ${timePattern.label}`);
            }
        }

        const reasoning = `Time sensitivity: ${score.toFixed(1)}/10 - ${indicators.length > 0 ? indicators.join(', ') : 'Standard urgency'}`;

        return { score, reasoning, indicators };
    }

    /**
     * FACTOR 4: Scale (15% weight)
     * Evaluates number of people affected
     */
    calculateScale(data, message) {
        let score = 2; // Default for small group
        const indicators = [];

        const quantity = data.quantity || 0;

        if (quantity > 0) {
            // Scoring based on number of people
            if (quantity >= 1000) {
                score = 10;
                indicators.push(`Large scale: ${quantity}+ people affected`);
            } else if (quantity >= 500) {
                score = 9;
                indicators.push(`Major incident: ${quantity} people`);
            } else if (quantity >= 100) {
                score = 7;
                indicators.push(`Significant group: ${quantity} people`);
            } else if (quantity >= 50) {
                score = 5;
                indicators.push(`Moderate group: ${quantity} people`);
            } else if (quantity >= 10) {
                score = 3;
                indicators.push(`Small group: ${quantity} people`);
            } else {
                score = 2;
                indicators.push(`Individual or very small group: ${quantity}`);
            }
        }

        // Check for scale keywords
        const scaleKeywords = [
            { pattern: /mass casualty|massive|hundreds|thousands/i, label: "Mass casualty event", score: 10 },
            { pattern: /entire (village|community|neighborhood|building)/i, label: "Entire community affected", score: 8 },
            { pattern: /family|families/i, label: "Families affected", score: 4 }
        ];

        for (const keyword of scaleKeywords) {
            if (keyword.pattern.test(message)) {
                score = Math.max(score, keyword.score);
                indicators.push(keyword.label);
            }
        }

        const reasoning = `Scale impact: ${score.toFixed(1)}/10 - ${indicators.join(', ')}`;

        return { score, reasoning, indicators };
    }

    /**
     * FACTOR 5: Environmental Factors (10% weight)
     * Evaluates environmental conditions making situation worse
     */
    calculateEnvironmentalFactors(data, message) {
        let score = 0;
        const indicators = [];

        // Weather and environmental hazards
        const environmentalFactors = [
            { pattern: /freezing|extreme cold|hypothermia|snow|blizzard/i, label: "Extreme cold", points: 3 },
            { pattern: /heat wave|extreme heat|heat stroke/i, label: "Extreme heat", points: 3 },
            { pattern: /flood|flooding|inundated|submerged/i, label: "Flooding", points: 4 },
            { pattern: /fire|burning|flames/i, label: "Fire hazard", points: 5 },
            { pattern: /earthquake|aftershock|tremor/i, label: "Earthquake", points: 4 },
            { pattern: /storm|hurricane|cyclone|tornado/i, label: "Severe storm", points: 4 },
            { pattern: /landslide|mudslide|avalanche/i, label: "Landslide", points: 4 },
            { pattern: /collapsed|collapse|structural damage/i, label: "Building collapse", points: 5 },
            { pattern: /trapped|stuck|stranded/i, label: "People trapped", points: 4 },
            { pattern: /no (shelter|roof|protection)/i, label: "Exposed to elements", points: 2 },
            { pattern: /contaminated|polluted|unsafe/i, label: "Contamination", points: 3 }
        ];

        for (const factor of environmentalFactors) {
            if (factor.pattern.test(message)) {
                score += factor.points;
                indicators.push(factor.label);
            }
        }

        // Temperature mentions
        if (/temperature.{0,20}(dropping|falling|freezing)/i.test(message)) {
            score += 2;
            indicators.push("Temperature dropping");
        }

        score = Math.min(10, score);

        const reasoning = indicators.length > 0
            ? `Environmental factors: ${score.toFixed(1)}/10 - ${indicators.join(', ')}`
            : "No significant environmental factors detected";

        return { score, reasoning, indicators };
    }

    /**
     * FACTOR 6: Resource Availability (5% weight)
     * Considers how critical/rare the needed resource is
     */
    calculateResourceAvailability(data, message) {
        let score = 5; // Default moderate
        const indicators = [];

        const resourceCriticality = {
            'medical': { score: 8, label: "Medical resources (critical)" },
            'rescue': { score: 9, label: "Rescue operations (critical)" },
            'ambulance': { score: 8, label: "Ambulance (critical)" },
            'water': { score: 7, label: "Clean water (essential)" },
            'food': { score: 6, label: "Food (essential)" },
            'shelter': { score: 6, label: "Shelter (essential)" },
            'blankets': { score: 4, label: "Blankets (important)" },
            'clothing': { score: 3, label: "Clothing (standard)" }
        };

        if (data.need_type && resourceCriticality[data.need_type]) {
            const resource = resourceCriticality[data.need_type];
            score = resource.score;
            indicators.push(resource.label);
        }

        // Scarcity indicators
        if (/rare|scarce|limited|shortage/i.test(message)) {
            score = Math.min(10, score + 2);
            indicators.push("Resource scarcity mentioned");
        }

        const reasoning = `Resource criticality: ${score.toFixed(1)}/10 - ${indicators.join(', ')}`;

        return { score, reasoning, indicators };
    }

    /**
     * Calculate multipliers for extreme situations
     */
    calculateMultipliers(data, message) {
        let multiplier = 1.0;
        const applied = [];
        const reasoning = [];

        // Multiple exclamation marks indicate panic/extreme urgency
        const exclamationCount = (message.match(/!/g) || []).length;
        if (exclamationCount >= 3) {
            multiplier *= 1.15;
            applied.push(`High urgency markers (${exclamationCount} exclamation marks)`);
        }

        // All caps words indicate shouting/panic
        const capsWords = message.match(/\b[A-Z]{3,}\b/g) || [];
        if (capsWords.length >= 2) {
            multiplier *= 1.1;
            applied.push(`Panic indicators (${capsWords.length} words in CAPS)`);
        }

        // Combination of multiple critical factors
        const criticalKeywords = [
            /emergency/i, /urgent/i, /critical/i, /dying/i, 
            /help/i, /please/i, /sos/i, /911/i
        ];
        const criticalCount = criticalKeywords.filter(pattern => pattern.test(message)).length;
        if (criticalCount >= 3) {
            multiplier *= 1.2;
            applied.push(`Multiple critical indicators (${criticalCount} keywords)`);
        }

        if (applied.length > 0) {
            reasoning.push(`Urgency multiplier applied (×${multiplier.toFixed(2)}): ${applied.join(', ')}`);
        }

        return { multiplier, applied, reasoning: reasoning.join('. ') };
    }

    /**
     * Helper functions
     */
    getUrgencyLevel(score) {
        if (score >= 9) return 'critical';
        if (score >= 7) return 'high';
        if (score >= 5) return 'medium';
        if (score >= 3) return 'low';
        return 'minimal';
    }

    getImpactLevel(score) {
        if (score >= 8) return 'CRITICAL';
        if (score >= 6) return 'HIGH';
        if (score >= 4) return 'MODERATE';
        return 'LOW';
    }

    formatFactorName(name) {
        return name.split('_').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }

    generateSummary(score, reasoning) {
        const level = this.getUrgencyLevel(score);
        const topFactors = reasoning
            .filter(r => r.impact === 'CRITICAL' || r.impact === 'HIGH')
            .slice(0, 3);

        if (topFactors.length === 0) {
            return `Urgency level: ${level.toUpperCase()} (${score.toFixed(1)}/10). No critical factors detected.`;
        }

        const factorNames = topFactors.map(f => f.factor).join(', ');
        return `Urgency level: ${level.toUpperCase()} (${score.toFixed(1)}/10). Primary concerns: ${factorNames}.`;
    }

    generateRecommendation(level, data) {
        const recommendations = {
            'critical': {
                action: 'IMMEDIATE DISPATCH REQUIRED',
                timeline: 'Response needed within 15-30 minutes',
                priority: 'Highest priority - activate emergency protocols'
            },
            'high': {
                action: 'Urgent response needed',
                timeline: 'Response needed within 1-2 hours',
                priority: 'High priority - fast-track resource allocation'
            },
            'medium': {
                action: 'Timely response recommended',
                timeline: 'Response needed within 4-6 hours',
                priority: 'Standard priority - normal resource allocation'
            },
            'low': {
                action: 'Standard response',
                timeline: 'Response within 12-24 hours acceptable',
                priority: 'Standard priority - schedule according to availability'
            },
            'minimal': {
                action: 'Non-urgent response',
                timeline: 'Response within 24-48 hours',
                priority: 'Low priority - address when resources available'
            }
        };

        return recommendations[level] || recommendations['medium'];
    }
}

module.exports = UrgencyScorer;
