const bcrypt = require('bcrypt');
const db = require('../config/database');
const { generateToken } = require('../middleware/auth');

/**
 * User login
 */
const login = async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({
            success: false,
            message: 'Email and password are required'
        });
    }
    console.log('Login attempt for email:', email);
    console.log('Request body:', req.body);
    try {
        // Find user by email
        const query = 'SELECT * FROM users WHERE email = $1';
        const result = await db.query(query, [email]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }
        
        const user = result.rows[0];
        
        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }
        
        // Update last login
        await db.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
        
        // Generate JWT token
        const token = generateToken(user);
        
        // Remove password from response
        delete user.password_hash;
        
        res.json({
            success: true,
            message: 'Login successful',
            data: {
                user,
                token
            }
        });
        
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: error.message
        });
    }
};

/**
 * User registration
 */
const register = async (req, res) => {
    const { email, password, full_name, role, phone, organization } = req.body;
    
    if (!email || !password || !full_name) {
        return res.status(400).json({
            success: false,
            message: 'Email, password, and full name are required'
        });
    }
    
    // Validate role
    const validRoles = ['dispatcher', 'admin'];
    const userRole = role && validRoles.includes(role) ? role : 'dispatcher';
    
    try {
        // Check if user already exists
        const checkQuery = 'SELECT id FROM users WHERE email = $1';
        const checkResult = await db.query(checkQuery, [email]);
        
        if (checkResult.rows.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'User with this email already exists'
            });
        }
        
        // Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        
        // Insert new user
        const insertQuery = `
            INSERT INTO users (email, password_hash, full_name, role, phone, organization)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, email, full_name, role, phone, organization, is_active, created_at
        `;
        
        const values = [email, passwordHash, full_name, userRole, phone, organization];
        const result = await db.query(insertQuery, values);
        
        const newUser = result.rows[0];
        
        // Generate JWT token
        const token = generateToken(newUser);
        
        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: {
                user: newUser,
                token
            }
        });
        
    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed',
            error: error.message
        });
    }
};

/**
 * Get current user profile
 */
const getProfile = async (req, res) => {
    const userId = req.user.id;
    
    try {
        const query = `
            SELECT id, email, full_name, role, phone, organization, is_active, created_at, last_login
            FROM users
            WHERE id = $1
        `;
        
        const result = await db.query(query, [userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        res.json({
            success: true,
            data: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error getting profile:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve profile',
            error: error.message
        });
    }
};

/**
 * Update user profile
 */
const updateProfile = async (req, res) => {
    const userId = req.user.id;
    const { full_name, phone, organization } = req.body;
    
    try {
        const query = `
            UPDATE users
            SET 
                full_name = COALESCE($1, full_name),
                phone = COALESCE($2, phone),
                organization = COALESCE($3, organization)
            WHERE id = $4
            RETURNING id, email, full_name, role, phone, organization, is_active, created_at
        `;
        
        const values = [full_name, phone, organization, userId];
        const result = await db.query(query, values);
        
        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile',
            error: error.message
        });
    }
};

/**
 * Change password
 */
const changePassword = async (req, res) => {
    const userId = req.user.id;
    const { current_password, new_password } = req.body;
    
    if (!current_password || !new_password) {
        return res.status(400).json({
            success: false,
            message: 'Current password and new password are required'
        });
    }
    
    if (new_password.length < 6) {
        return res.status(400).json({
            success: false,
            message: 'New password must be at least 6 characters long'
        });
    }
    
    try {
        // Get current password hash
        const query = 'SELECT password_hash FROM users WHERE id = $1';
        const result = await db.query(query, [userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const user = result.rows[0];
        
        // Verify current password
        const isPasswordValid = await bcrypt.compare(current_password, user.password_hash);
        
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }
        
        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const newPasswordHash = await bcrypt.hash(new_password, salt);
        
        // Update password
        await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPasswordHash, userId]);
        
        res.json({
            success: true,
            message: 'Password changed successfully'
        });
        
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to change password',
            error: error.message
        });
    }
};

module.exports = {
    login,
    register,
    getProfile,
    updateProfile,
    changePassword
};
