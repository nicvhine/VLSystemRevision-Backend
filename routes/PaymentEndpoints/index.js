const express = require("express");
const router = express.Router();

const getPayment = require("./getPayment");
const postPayment = require("./postPayment");

module.exports = (db) => {
  router.use("/", getPayment(db));
  router.use("/", postPayment(db));
  return router;
};
