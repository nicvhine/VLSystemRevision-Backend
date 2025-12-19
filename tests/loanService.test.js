const { connect, clear, close, getDb } = require('./testDB');
const loanService = require('../services/loanService');
const { mockApplication, mockBorrower} = require('./mocks');

let db;

beforeAll(async () => {
  await connect();
  db = getDb();
});

afterEach(async () => await clear());
afterAll(async () => await close());

describe('Loan Service', () => {
  test('should generate loan', async () => {
    const applicationId = 'test-app-001';
    const borrowersId = 'BRW001'
    const balance = 10000;

    const applicationData = {
      borrowersId: borrowersId,
      appTotalPayable: balance
    }

    const application = await mockApplication(db, applicationId, applicationData);

    const borrowerData = {
      name: application.appName,
      dob: application.appDob,
      contact: application.appContact,
      email: application.appEmail,
      address: application.appAddress,
      monthlyIncome: application.appMonthlyIncome,
      applicationId: application.applicationId,
    };

    const borrower = await mockBorrower(db, borrowersId, borrowerData);
    const loan = await loanService.createLoan(applicationId, db);
    const collections = await db.collection('collections').find({ loanId: loan.loanId }).toArray();

    expect(application).toBeDefined();
    expect(application.applicationId).toBe(applicationId);
    expect(application.appTotalPayable).toBe(balance);

    expect(borrower).toBeDefined();
    expect(borrower.borrowersId).toBe(borrowersId);

    expect(loan).toBeDefined();
    expect(loan.applicationId).toBe(applicationId);
    expect(loan.borrowersId).toBe(borrowersId);
    expect(loan.balance).toBe(balance);

    expect(collections).toBeDefined();

  });
});
