const express = require("express");
const router = express.Router();

const postLoan = require("./postLoan");
const getLoan = require("./getLoan");
const putLoan = require("./putLoan");

module.exports = (db) => {
  router.use("/", postLoan(db));
  router.use("/", getLoan(db));
  router.use("/", putLoan(db));

  return router;
};
