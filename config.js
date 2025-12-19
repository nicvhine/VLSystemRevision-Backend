const allowedOrigins = [
    'http://localhost:3000',
    'https://vlsystem.vistula.ph'
];

module.exports = {
    PORT: process.env.PORT || 3001,
    MONGODB_URI: process.env.MONGODB_URI,
    CORS_OPTIONS: {
        origin: function (origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
    },
    BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:3001',
};

// module.exports = {
//     PORT: process.env.PORT || 3001,
//     MONGODB_URI: process.env.MONGODB_URI,
//     CORS_OPTIONS: {
//         origin: ['http://localhost:3000', 'http://localhost:3002'],
//         methods: ['GET', 'POST', 'PUT', 'DELETE'],
//         allowedHeaders: ['Content-Type', 'Authorization'],
//         credentials: true,
//     },
//     BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:3001',
// };