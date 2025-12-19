const { MongoClient } = require('mongodb');
const { MONGODB_URI } = require('../config');

const client = new MongoClient(MONGODB_URI);

// Connect to MongoDB and return the database instance
async function connectToDatabase() {
    await client.connect();
    return client.db('VLSystem');
}

// Close the MongoDB client connection
function closeDatabase() {
    return client.close();
}

// Atomically increment and return a named counter
async function getNextSequence(db, name) {
    const counters = db.collection('counters');
    const result = await counters.findOneAndUpdate(
        { _id: name },
        { $inc: { seq: 1 } },
        { returnDocument: 'after', upsert: true }
    );
    if (!result.value || typeof result.value.seq !== 'number') {
        await counters.updateOne({ _id: name }, { $set: { seq: 1 } }, { upsert: true });
        return 1;
    }
    return result.value.seq;
}

// Get the highest numeric id from a collection field
async function getMaxNumericId(db, collectionName, fieldName, stripPrefix = false) {
    const collection = db.collection(collectionName);
    const pipeline = [
        {
            $addFields: {
                numericId: {
                    $convert: {
                        input: stripPrefix ? { $substr: [`$${fieldName}`, 1, -1] } : `$${fieldName}`,
                        to: "int",
                        onError: 0,
                        onNull: 0
                    }
                }
            }
        },
        { $sort: { numericId: -1 } },
        { $limit: 1 }
    ];
    const result = await collection.aggregate(pipeline).toArray();
    return result.length > 0 ? result[0].numericId : 0;
}

module.exports = { connectToDatabase, closeDatabase, getNextSequence, getMaxNumericId};