const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');

let mongoServer;
let client;
let db;

const connect = async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    client = await MongoClient.connect(uri);
    db = client.db();
};

const clear = async () => {
    const collections = await db.collections();
    for (const collection of collections) {
        await collection.deleteMany({});
    }
};

const close = async () => {
    await client.close();
    await mongoServer.stop();
};

module.exports = { connect, clear, close, getDb: () => db };
