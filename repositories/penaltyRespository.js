module.exports = (db) => {
    const collection = db.collection("penalty_endorsements");
  
    return {
      async create(data) {
        const result = await collection.insertOne(data);
        return result.insertedId;
      },
  
      async getAll(filter = {}) {
        return await collection.find(filter).sort({ dateEndorsed: -1 }).toArray();
      },
  
      async getById(id) {
        const { ObjectId } = require("mongodb");
        return await collection.findOne({ _id: new ObjectId(id) });
      },
  
      async update(id, data) {
        const { ObjectId } = require("mongodb");
        const result = await collection.updateOne(
          { _id: new ObjectId(id) },
          { $set: data }
        );
        return result.modifiedCount;
      },
    };
  };
  