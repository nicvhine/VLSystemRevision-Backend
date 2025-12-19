const express = require("express");
const router = express.Router();

const postAgent = require("./postAgent");
const getAgents = require("./getAgent");
const putAgent = require("./putAgent");

// Mount agent endpoints (create and read)
module.exports = (db) => {
  router.use("/", postAgent(db));
  router.use("/", getAgents(db));
  router.use("/", putAgent(db));
  return router;
};
