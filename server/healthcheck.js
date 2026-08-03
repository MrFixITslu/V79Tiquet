/**
 * server/healthcheck.js — Lightweight health probe
 */
import db from "./db.js";

export const registerHealthCheck = (app) => {
    app.get('/health', (req, res) => {
        try {
            // Check DB connection
            const result = db.prepare("SELECT 1").get();
            if (!result) throw new Error("DB probe failed");

            res.status(200).json({
                status: "healthy",
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                environment: process.env.NODE_ENV || 'development'
            });
        } catch (e) {
            res.status(503).json({
                status: "unhealthy",
                error: e.message
            });
        }
    });
};
