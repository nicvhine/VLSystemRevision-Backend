require('dotenv').config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { CORS_OPTIONS } = require("./config");
const {connectToDatabase} = require("./utils/database");
const loadCounters = require("./loadCounters");
const loadRoutes = require("./loadRoutes");

async function createApp() {
    const app = express();

    app.use(express.json());
    app.use("/uploads", express.static(path.join(__dirname, "uploads")));
    app.use(cors(CORS_OPTIONS));

    // // Log all incoming requests for debugging
    // app.use((req, res, next) => {
    //     console.log(`🌐 ${req.method} ${req.url} from ${req.headers.origin || 'no-origin'}`);
    //     next();
    // });

    // Initialize database and load routes
    const db = await connectToDatabase();
    await loadCounters(db);
    loadRoutes(app, db);

    return app;
}

module.exports = createApp;
