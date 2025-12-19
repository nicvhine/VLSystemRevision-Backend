async function logAction(db, actor, action, details) {
  try {
    await db.collection('logs').insertOne({
      timestamp: new Date(),
      actor,
      action,
      details,
    });
  } catch (err) {
    console.error('Failed to log action:', err);
  }
}

module.exports = logAction;
