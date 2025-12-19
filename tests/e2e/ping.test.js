const request = require("supertest");
const createApp = require("../../createApp");

let app;

beforeAll(async () => {
    app = await createApp(); 
});

describe("Ping API", () => {
    it("GET /ping should return pong", async () => {
        const res = await request(app).get("/ping");
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ message: "pong from root" });
    });
});
