/**
 * Calculate active billing cycle start and end dates based on a user's billingCycleDay.
 * Credit card cycles often run e.g. from the 15th of one month to the 14th of next month.
 *
 * @param {number} billingCycleDay - Day of the month billing cycle starts (1-28)
 * @param {Date} [referenceDate] - Optional date to calculate cycle for (defaults to now)
 * @returns {{ cycleStart: Date, cycleEnd: Date }}
 */
function getBillingCycleRange(billingCycleDay = 1, referenceDate = new Date()) {
  const day = Math.min(28, Math.max(1, parseInt(billingCycleDay, 10) || 1));
  const now = new Date(referenceDate);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentDate = now.getDate();

  let cycleStart, cycleEnd;

  if (currentDate >= day) {
    // Current cycle started this month on billingCycleDay
    cycleStart = new Date(currentYear, currentMonth, day, 0, 0, 0, 0);
    // Ends next month on billingCycleDay - 1
    cycleEnd = new Date(currentYear, currentMonth + 1, day - 1, 23, 59, 59, 999);
  } else {
    // Current cycle started previous month on billingCycleDay
    cycleStart = new Date(currentYear, currentMonth - 1, day, 0, 0, 0, 0);
    // Ends this month on billingCycleDay - 1
    cycleEnd = new Date(currentYear, currentMonth, day - 1, 23, 59, 59, 999);
  }

  return { cycleStart, cycleEnd };
}

module.exports = {
  getBillingCycleRange,
};
