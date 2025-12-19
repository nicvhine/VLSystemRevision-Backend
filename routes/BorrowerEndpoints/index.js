const express = require("express");
const router = express.Router();

const postBorrower = require("./postBorrower");
const putBorrower = require("./putBorrower");
const getBorrower = require("./getBorrower");

module.exports = (db) => {
  router.use("/", postBorrower(db));
  router.use("/", putBorrower(db));
  router.use("/", getBorrower(db));
  return router;
};
