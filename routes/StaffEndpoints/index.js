const express = require("express");
const router = express.Router();

const postStaff = require("./postStaff");
const getStaff = require("./getStaff");
const deleteStaff = require("./deleteStaff");
const putStaff = require("./putStaff");

module.exports = (db) => {
  router.use("/", postStaff(db));
  router.use("/", getStaff(db));
  router.use("/", deleteStaff(db));
  router.use("/", putStaff(db));
  return router;
};