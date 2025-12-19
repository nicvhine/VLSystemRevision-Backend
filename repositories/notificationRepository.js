module.exports = (db) => {
  const loanOfficerNotifications = db.collection("loanOfficer_notifications");
  const managerNotifications = db.collection("manager_notifications");
  const borrowerNotifications = db.collection("borrower_notifications");
  const collectorNotifications = db.collection("collector_notifications");
  const collections = db.collection("collections");

  return {
    // Loan Officer queries
    getLoanOfficerNotifications: () =>
      loanOfficerNotifications.find({}).sort({ createdAt: -1 }).limit(50).toArray(),

    markLoanOfficerNotificationRead: async (id) => {
      const { ObjectId } = require("mongodb");
      const filter = ObjectId.isValid(id)
        ? { _id: new ObjectId(id) }
        : { id };

      const result = await loanOfficerNotifications.findOneAndUpdate(
        filter,
        { $set: { read: true, viewed: true } },
        { returnDocument: "after" }
      );

      return result;
    },

    markAllLoanOfficerNotificationsRead: () =>
      loanOfficerNotifications.updateMany(
        {
          $or: [
            { read: { $ne: true } },
            { viewed: { $ne: true } }
          ]
        },
        { $set: { read: true, viewed: true } }
      ),

    // Manager queries
    getManagerNotifications: () =>
      managerNotifications.find({}).sort({ createdAt: -1 }).limit(50).toArray(),

    markManagerNotificationRead: (id) => {
      const { ObjectId } = require("mongodb");
      const filter = ObjectId.isValid(id)
        ? { _id: new ObjectId(id) }
        : { id };

      return managerNotifications.findOneAndUpdate(
        filter,
        { $set: { read: true, viewed: true } },
        { returnDocument: "after" }
      );
    },

    markAllManagerNotificationsRead: () =>
      managerNotifications.updateMany(
        {
          $or: [
            { read: { $ne: true } },
            { viewed: { $ne: true } }
          ]
        },
        { $set: { read: true, viewed: true } }
      ),

    // Collector queries
    getCollectorNotifications: () =>
      collectorNotifications.find({}).sort({ createdAt: -1 }).limit(50).toArray(),

    markCollectorNotificationRead: (id) => {
      const { ObjectId } = require("mongodb");
      const filter = ObjectId.isValid(id)
        ? { _id: new ObjectId(id) }
        : { id };

      return collectorNotifications.findOneAndUpdate(
        filter,
        { $set: { read: true, viewed: true } },
        { returnDocument: "after" }
      );
    },

    markAllCollectorNotificationsRead: () =>
      collectorNotifications.updateMany(
        { 
          $or: [
            { read: { $ne: true } },
            { viewed: { $ne: true } }
          ]
        },
        { $set: { read: true, viewed: true } }
      ),

    // Borrower queries
    getBorrowerNotifications: (borrowersId) =>
      borrowerNotifications.find({ borrowersId }).sort({ createdAt: -1 }).toArray(),

    markBorrowerNotificationRead: (id, borrowersId) => {
      const { ObjectId } = require("mongodb");
      const filter = ObjectId.isValid(id)
        ? { _id: new ObjectId(id) }
        : { id };

      return borrowerNotifications.findOneAndUpdate(
        { ...filter, borrowersId },
        { $set: { read: true, viewed: true } },
        { returnDocument: "after" }
      );
    },

    markAllBorrowerNotificationsRead: (borrowersId) =>
      borrowerNotifications.updateMany(
        {
          borrowersId,
          $or: [
            { read: { $ne: true } },
            { viewed: { $ne: true } }
          ]
        },
        { $set: { read: true, viewed: true } }
      ),

    // Collections for auto-notifications
    findDueCollections: (borrowersId, today, threeDaysLater) =>
      collections
        .find({
          borrowersId,
          status: "Unpaid",
          dueDate: { $gte: today, $lte: threeDaysLater },
        })
        .sort({ dueDate: 1 })
        .toArray(),

    findExistingDueRefs: (borrowersId) =>
      borrowerNotifications
        .find({ borrowersId, type: "due" })
        .toArray()
        .then((docs) => docs.map((n) => n.referenceNumber)),

    // Insert functions
    insertLoanOfficerNotification: (notif) =>
      notif ? loanOfficerNotifications.insertOne(notif) : null,

    insertManagerNotification: (notif) =>
      notif ? managerNotifications.insertOne(notif) : null,

    insertCollectorNotification: (notif) =>
      notif ? collectorNotifications.insertOne(notif) : null,

    insertBorrowerNotifications: (notifs) =>
      Array.isArray(notifs)
        ? borrowerNotifications.insertMany(notifs)
        : borrowerNotifications.insertOne(notifs),
  };
};
