function computeApplicationAmounts(principal, interestRate, terms, loanType) {
  principal = Number(principal || 0);
  interestRate = Number(interestRate || 0);
  terms = Number(terms || 0);

  // Always compute monthly interest (even for open-term)
  const interestAmount = principal * (interestRate / 100);

  let totalInterestAmount = 0;
  let appMonthlyDue = 0;
  let totalPayable = 0;

  if (loanType !== "open-term") {
    // Regular calculation
    totalInterestAmount = interestAmount * terms;
    totalPayable = principal + totalInterestAmount;
    appMonthlyDue = totalPayable / terms;
  }

  // For OPEN-TERM:
  // totalInterestAmount = 0
  // totalPayable = 0
  // appMonthlyDue = 0
  // (interestAmount already computed above)

  // Service fee logic
  let serviceFee = 0;

  if (principal >= 10000 && principal <= 20000) {
    serviceFee = principal * 0.05;
  } else if (principal >= 25000 && principal <= 40000) {
    serviceFee = 1000;
  } else if (principal >= 50000 && principal <= 500000) {
    serviceFee = principal * 0.03;
  }

  const appNetReleased = principal - serviceFee;

  return {
    interestAmount,
    totalInterestAmount,
    appMonthlyDue,
    totalPayable,
    serviceFee,
    appNetReleased
  };
}

module.exports = { computeApplicationAmounts };
