const { connect, clear, close, getDb } = require('./testDB');
const borrowerService = require('../services/borrowerService');
const bcrypt = require('bcrypt');
const borrowerSchema = require("../schemas/borrowerSchema");
const {mockApplication} = require("./mocks");

beforeAll(async () => await connect());
afterEach(async () => await clear());
afterAll(async () => await close());

describe('Borrower Service', () => {
    test('should create and return borrower', async () => {
        const db = getDb();
        const applicationId = 'APP001';
        const applicationData = await mockApplication(db, applicationId, null);

        const data = {
            name: 'Brad Pitt',
            role: 'borrower',
            applicationId,
            assignedCollector: 'AG001'
        };
         
        const { borrower, tempPassword } = await borrowerService.createBorrower(data, db);

        expect(() => borrowerSchema.parse(borrower)).not.toThrow();

        expect(borrower.name).toBe(data.name);
        expect(borrower.email).toBe(applicationData.appEmail);
        expect(borrower.username).toContain('brapitt');
        expect(await bcrypt.compare(tempPassword, borrower.password)).toBe(true);

    });

    test('should throw name required error', async () => {
        const db = getDb();
        const applicationId = 'APP001';

        const data = {
            role: 'borrower',
            applicationId,
            assignedCollector: 'AG001'
        };

        await expect(borrowerService.createBorrower(data, db))
            .rejects
            .toThrow("Name, role, and applicationId are required");
    });

    test('should throw applicationId required error', async () => {
        const db = getDb();

        const data = {
            name: 'Brad Pitt',
            role: 'borrower',
            assignedCollector: 'AG001'
        };

        await expect(borrowerService.createBorrower(data, db))
            .rejects
            .toThrow("Name, role, and applicationId are required");
    });

});
