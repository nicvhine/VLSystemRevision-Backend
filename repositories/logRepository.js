module.exports = (db) => {
  const collection = db.collection("activity_logs");

  async function insertActivityLog(logData) {
    const count = await collection.countDocuments();
    const logId = `LOG${(count + 1).toString().padStart(6, "0")}`;

    const logEntry = {
      logId,
      userId: logData.userId,
      name: logData.name,
      role: logData.role,
      action: logData.action,
      description: logData.description,
      createdAt: logData.createdAt || new Date(),
    };

    await collection.insertOne(logEntry);
    return logEntry;
  }

  return { insertActivityLog };
};
