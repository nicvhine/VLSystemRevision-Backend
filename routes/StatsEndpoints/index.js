const express = require("express");
const router = express.Router();

const getLO = require("./loanOfficer");
const getManager = require("./managerHead");
module.exports = (db) => {
  router.use("/", getLO(db));
  router.use("/", getManager(db));

  return router;
};