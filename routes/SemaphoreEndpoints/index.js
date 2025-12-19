const express = require("express");
const router = express.Router();

const postSms = require("./postSMS");

module.exports = (db) => {
    router.use("/", postSms(db));
    
    return router;
};


