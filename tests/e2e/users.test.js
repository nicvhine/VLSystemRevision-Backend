const request = require("supertest");
const createApp = require("../../createApp");

let app;

beforeAll(async () => {
    app = await createApp();
});

describe("POST /users/login", () => {
    it("should return 200 and a token for valid credentials", async () => {
        const res = await request(app)
            .post("/users/login")
            .send({
                username: "headmark",
                password: "Magdadaro25!"
            });

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("token");
    });

    it("should return 401 for invalid credentials", async () => {
        const res = await request(app)
            .post("/users/login")
            .send({
                username: "username",
                password: "wrong_pass"
            });

        expect(res.statusCode).toBe(401);
        expect(res.body).toHaveProperty("error", "Invalid credentials");
    });
});
