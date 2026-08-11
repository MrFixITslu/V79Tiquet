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
                uptime: process.uptime()
            });
        } catch (e) {
            res.status(503).json({
                status: "unhealthy",
                error: e.message
            });
        }
    });

    // Deeper readiness probe: liveness (/health) just confirms the process
    // is up; this confirms the app can actually serve requests (DB
    // reachable and responsive). Kept separate so orchestration/monitoring
    // can distinguish "process alive" from "ready for traffic" without
    // either endpoint leaking connection strings, secrets, or paths.
    app.get('/health/ready', (req, res) => {
        try {
            const result = db.prepare("SELECT 1").get();
            if (!result) throw new Error("Database not responding");
            res.status(200).json({ status: "ready", database: "connected" });
        } catch (e) {
            res.status(503).json({ status: "not_ready", database: "unreachable" });
        }
    });
};
