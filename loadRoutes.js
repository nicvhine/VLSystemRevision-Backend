const {getNextSequence} = require("./utils/database");
const express = require('express');

// Register API routes and static assets
function loadRoutes(app, db) {
    const userRoutes = require('./routes/StaffEndpoints')(db);
    const loanApplicationRoutes = require('./routes/ApplicationEndpoints')(db, getNextSequence);
    const borrowersRoutes = require('./routes/BorrowerEndpoints')(db);
    const loanRoutes = require('./routes/LoanEndpoints')(db);
    const collectionRoutes = require('./routes/CollectionEndpoints')(db);
    const paymentRoutes = require('./routes/PaymentEndpoints')(db);
    const notificationRoutes = require('./routes/NotificationEndpoints')(db);
    const smsRoutes = require('./routes/SemaphoreEndpoints')(db);
    const agentRoutes = require('./routes/AgentEndpoints')(db);
    const statRoutes = require('./routes/StatsEndpoints')(db);
    const penaltyRoutes = require('./routes/PenaltyEndpoints')(db);
    const closureRoutes = require('./routes/ClosureEndpoints')(db);
    const otpRoutes = require('./routes/otpEndpoint')(db);
    const sysadRoutes = require('./routes/sysadDashboard')(db);

    // TESTING CRONS

    // const { startPendingApplicationCheckerTest } = require("./Crons/TestingCrons/pendingApplicationChecker");
    // startPendingApplicationCheckerTest(db);
    // require('./Crons/TestingCrons/unscheduleCleanup');
    // require('./Crons/TestingCrons/collectionsDue');
    // const { startBorrowerDueTest } = require("./Crons/TestingCrons/borrowerDueNotif");
    // startBorrowerDueTest(db);


    // PRODUCTION CRON

    // const { startPendingApplicationCheckerProd } = require("./Crons/ProductionCrons/pendingApplicationChecker");
    // startPendingApplicationCheckerProd(db);
    // require('./Crons/ProductionCrons/unscheduledCleanup');
    // require('./Crons/ProductionCrons/collectionsDue');
    // const { startBorrowerDueProd } = require("./Crons/ProductionCrons/borrowerDueNotif");
    // startBorrowerDueProd(db);
    
    const { startCollectorNotificationCron } = require("./routes/CollectionEndpoints/collectorNotificationCron");
    startCollectorNotificationCron(db);
    
    app.use('/users', userRoutes);
    app.use('/loan-applications', loanApplicationRoutes);
    app.use('/borrowers', borrowersRoutes);
    app.use('/loans', loanRoutes);
    app.use('/collections', collectionRoutes);
    app.use('/payments', paymentRoutes);
    app.use('/notifications', notificationRoutes);
    app.use('/sms', smsRoutes);
    app.use('/uploads', express.static('uploads'));
    app.use('/agents', agentRoutes);
    app.use('/stat', statRoutes);
    app.use('/penalty', penaltyRoutes);
    app.use('/closure', closureRoutes);
    app.use('/otp', otpRoutes);
    app.use('/sysad', sysadRoutes);

    app.get("/ping", (req, res) => { res.json({ message: "pong from root" }); });

    // 404 handler for debugging
    app.use((req, res, next) => {
        console.log(`❌ 404 - Route not found: ${req.method} ${req.url}`);
        res.status(404).json({ error: 'Route not found', url: req.url, method: req.method });
    });

    console.log('Routes loaded');

}

module.exports = loadRoutes