const express = require("express");
const router = express.Router();

const postClosure = require("./postClosure");
const getClosure = require("./getClosure");
const putClosure = require("./putClosure");

module.exports = (db) => {
    router.use("/", postClosure(db));
    router.use("/", getClosure(db));
    router.use("/", putClosure(db));
    return router;
}