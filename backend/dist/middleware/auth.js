"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const supabaseAdmin_1 = require("../lib/supabaseAdmin");
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'Missing bearer token' });
    }
    const { data, error } = await supabaseAdmin_1.supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.userId = data.user.id;
    req.userEmail = data.user.email ?? undefined;
    next();
}
