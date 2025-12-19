const notificationRepository = require("../repositories/notificationRepository");

async function getLoanOfficerNotifications(db) {
  const repo = notificationRepository(db);
  const notifs = await repo.getLoanOfficerNotifications();
  return await enrichWithActorProfilePic(db, notifs);
}

async function markLoanOfficerNotificationRead(db, id) {
  const repo = notificationRepository(db);
  return await repo.markLoanOfficerNotificationRead(id);
}

async function markAllLoanOfficerNotificationsRead(db) {
  const repo = notificationRepository(db);
  return await repo.markAllLoanOfficerNotificationsRead();
}

async function getManagerNotifications(db) {
  const repo = notificationRepository(db);
  const notifs = await repo.getManagerNotifications();
  return await enrichWithActorProfilePic(db, notifs);
}

async function markManagerNotificationRead(db, id) {
  const repo = notificationRepository(db);
  return await repo.markManagerNotificationRead(id);
}

async function markAllManagerNotificationsRead(db) {
  const repo = notificationRepository(db);
  return await repo.markAllManagerNotificationsRead();
}

async function getCollectorNotifications(db) {
  const repo = notificationRepository(db);
  const notifs = await repo.getCollectorNotifications();
  return await enrichWithActorProfilePic(db, notifs);
}

async function markCollectorNotificationRead(db, id) {
  const repo = notificationRepository(db);
  return await repo.markCollectorNotificationRead(id);
}

async function markAllCollectorNotificationsRead(db) {
  const repo = notificationRepository(db);
  return await repo.markAllCollectorNotificationsRead();
}
// NOTE: accept borrowersId here and pass it down
async function getBorrowerNotifications(db, borrowersId) {
  const repo = notificationRepository(db);
  const notifs = await repo.getBorrowerNotifications(borrowersId);
  return await enrichWithActorProfilePic(db, notifs);
}

// Enrich notifications with actor profile picture.
async function enrichWithActorProfilePic(db, notifications) {
  try {
    if (!Array.isArray(notifications) || notifications.length === 0) return notifications || [];

    // Collect possible identifiers
    const userIds = new Set();
    const usernames = new Set();
    const names = new Set();

    for (const n of notifications) {
      const actor = n.actor || {};
      const id = n.actorId || actor.id || n.userId || actor.userId;
      const username = n.actorUsername || actor.username || n.username || n.userName;
      const name = n.actorName || actor.name || n.userName || n.sender;
      if (id) userIds.add(String(id));
      if (username) usernames.add(String(username));
      if (name) names.add(String(name));
    }

    const usersCol = db.collection("users");
    const orConds = [];
    if (userIds.size) orConds.push({ userId: { $in: Array.from(userIds) } });
    if (usernames.size) orConds.push({ username: { $in: Array.from(usernames) } });
    if (names.size) orConds.push({ name: { $in: Array.from(names) } });

    let users = [];
    if (orConds.length > 0) {
      users = await usersCol.find({ $or: orConds }).project({ userId: 1, username: 1, name: 1, profilePic: 1 }).toArray();
    }

    const byUserId = new Map(users.map(u => [String(u.userId), u]));
    const byUsername = new Map(users.map(u => [String(u.username), u]));
    const byName = new Map(users.map(u => [String(u.name), u]));

    return notifications.map(n => {
      const actor = n.actor || {};
      const id = n.actorId || actor.id || n.userId || actor.userId;
      const username = n.actorUsername || actor.username || n.username || n.userName;
      const name = n.actorName || actor.name || n.userName || n.sender;

      let pic = null;
      if (id && byUserId.get(String(id))?.profilePic) pic = byUserId.get(String(id)).profilePic;
      else if (username && byUsername.get(String(username))?.profilePic) pic = byUsername.get(String(username)).profilePic;
      else if (name && byName.get(String(name))?.profilePic) pic = byName.get(String(name)).profilePic;

      if (pic) {
        n.actorProfilePic = pic;     // camelCase
        n.actorprofilepic = pic;     // lower-case variant as requested
        if (n.actor && typeof n.actor === 'object') n.actor.profilePic = pic;
      }
      return n;
    });
  } catch (err) {
    console.error("Failed to enrich notifications with actor profile pic:", err);
    return notifications || [];
  }
}

// Generic role-based operations
async function markNotificationRead(db, role, id, borrowersId) {
  const repo = notificationRepository(db);
  if (role === "loan-officer") {
    return await repo.markLoanOfficerNotificationRead(id);
  } else if (role === "manager") {
    return await repo.markManagerNotificationRead(id);
  } else if (role === "collector") {
    return await repo.markCollectorNotificationRead(id);
  } else if (role === "borrower") {
    if (!borrowersId) throw new Error("Missing borrowersId");
    return await repo.markBorrowerNotificationRead(id, borrowersId);
  }
  throw new Error("Invalid role");
}

async function markAllRoleRead(db, role, borrowersId) {
  const repo = notificationRepository(db);
  if (role === "loan-officer") {
    return await repo.markAllLoanOfficerNotificationsRead();
  } else if (role === "manager") {
    return await repo.markAllManagerNotificationsRead();
  } else if (role === "collector") {
    return await repo.markAllCollectorNotificationsRead();
  } else if (role === "borrower") {
    if (!borrowersId) throw new Error("Missing borrowersId");
    return await repo.markAllBorrowerNotificationsRead(borrowersId);
  }
  throw new Error("Invalid role");
}

module.exports = {
  getLoanOfficerNotifications,
  getManagerNotifications,
  getCollectorNotifications,
  getBorrowerNotifications,

  markLoanOfficerNotificationRead,
  markManagerNotificationRead,
  markCollectorNotificationRead,

  markAllLoanOfficerNotificationsRead,
  markAllManagerNotificationsRead,
  markAllCollectorNotificationsRead,
  markNotificationRead,
  markAllRoleRead,
};
