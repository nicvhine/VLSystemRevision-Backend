const express = require("express");
const router = express.Router();

const postApplication = require("./postApplication");
const getApplication = require("./getApplication");
const putApplication = require("./putApplication");
const uploadDocuments = require("./uploadDocuments");
const withdrawalRequest = require("./withdrawalRequest");
const ciChecklist = require("./ciChecklist");

// Mount application endpoints (create, read, update, upload)
module.exports = (db) => {
  router.use("/", postApplication(db));
  router.use("/", getApplication(db));
  router.use("/", putApplication(db));
  router.use("/", uploadDocuments(db));
  router.use("/", withdrawalRequest(db));
  router.use("/", ciChecklist(db));
  return router;
};
