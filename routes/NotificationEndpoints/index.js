const express = require("express");
const router = express.Router();

const getNotification = require("./getNotification");
const putNotification = require("./putNotification");

module.exports = (db) => {
  router.use("/", getNotification(db));
  router.use("/", putNotification(db));
  return router;
};
