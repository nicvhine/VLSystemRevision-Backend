const express = require("express");
const router = express.Router();

const postApplication = require("./postApplication");
const getApplication = require("./getApplication");
const putApplication = require("./putApplication");
const uploadDocuments = require("./uploadDocuments");

// Mount application endpoints (create, read, update, upload)
module.exports = (db) => {
  router.use("/", postApplication(db));
  router.use("/", getApplication(db));
  router.use("/", putApplication(db));
  router.use("/", uploadDocuments(db));
  return router;
};
