const express = require("express");
const router = express.Router();

const postPenalty = require("./postPenalty");
const putPenalty = require("./putPenalty");
const getPenalty = require("./getPenalty");

module.exports = (db) => {
    router.use("/", postPenalty(db));
    router.use("/", putPenalty(db));
    router.use("/", getPenalty(db));
    return router;
};


