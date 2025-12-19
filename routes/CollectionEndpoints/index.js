const express = require("express");
const router = express.Router();

const getCollection = require("./getCollection");
const putCollection = require("./putCollection");

module.exports = (db) => {
  router.use("/", getCollection(db));
  router.use("/", putCollection(db));
  return router;
};
