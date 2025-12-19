const { encrypt } = require('../utils/crypt');

module.exports = (db) => {
    const users = db.collection("users");
    const logs = db.collection("logs");
  
    return {
      findById: (userId) => users.findOne({ userId }),
      findByEmail: (email) => users.findOne({ email: encrypt(email.toLowerCase()) }),
      findByPhoneNumber: (phoneNumber) => users.findOne({ phoneNumber: encrypt(phoneNumber) }),
      findByName: (name) =>
        users.findOne({
          name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        }),
      findByUsername: (username) => users.findOne({ username }),
      findMaxUser: () =>
        users
          .aggregate([
            { $addFields: { userIdNum: { $toInt: "$userId" } } },
            { $sort: { userIdNum: -1 } },
            { $limit: 1 },
          ])
          .toArray(),
      insertUser: (user) => users.insertOne(user),
      updateProfilePic: (userId, profilePic) =>
        users.updateOne({ userId }, { $set: { profilePic } }),
        updateUserPassword: (userId, hashedPassword, extraFields = {}) =>
        users.updateOne(
            { userId },
            { $set: { password: hashedPassword, ...extraFields } }
        ),    
    };
    
  };
  