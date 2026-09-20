/**
 * Rule-based "insights" for the budget tracker — same philosophy as
 * js/advice.js: pattern rules over the user's own data, no external
 * AI call, no cost.
 *
 * @param {Array} expenses - all of the user's expense rows, each:
 *   { amount, category, description, expense_date, created_at }
 * @param {object} budget - the budgets row: { current_budget, initial_budget, warning_limit }
 * @returns {Array<{tag: string, text: string}>}
 */
export function generateInsights(expenses, budget) {
  const insights = [];

  if (!expenses.length) {
    return [{
      tag: "Get started",
      text: "No expenses logged yet. Once you've recorded a few, Anchor will start surfacing patterns here — spending trends, your biggest category, and a forecast of how long your budget will last.",
    }];
  }

  const today = new Date();
  const toISO = (d) => {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const thisMonthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthPrefix = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;

  // --- Forecast: days until budget hits zero, from daily average ------
  const trackedDates = new Set(expenses.map((e) => e.expense_date));
  const totalSpent = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const avgDaily = trackedDates.size > 0 ? totalSpent / trackedDates.size : 0;

  if (budget && avgDaily > 0) {
    const daysLeft = Math.ceil(Number(budget.current_budget) / avgDaily);
    if (daysLeft > 0 && daysLeft < 9999) {
      const predictedDate = new Date(today.getTime() + daysLeft * 86400000);
      insights.push({
        tag: "Forecast",
        text: `At your average of ₱${avgDaily.toFixed(2)}/day, your current budget lasts about ${daysLeft} more day${daysLeft === 1 ? "" : "s"} — around ${predictedDate.toLocaleDateString(undefined, { month: "long", day: "numeric" })}.`,
      });
    } else if (daysLeft <= 0) {
      insights.push({
        tag: "Forecast",
        text: `Your budget is already at or below zero at your current spending rate. Consider a top-up or a spending pause.`,
      });
    }
  }

  // --- Month-over-month trend ------------------------------------------
  const thisMonthTotal = expenses.filter((e) => e.expense_date.startsWith(thisMonthPrefix)).reduce((s, e) => s + Number(e.amount), 0);
  const lastMonthTotal = expenses.filter((e) => e.expense_date.startsWith(lastMonthPrefix)).reduce((s, e) => s + Number(e.amount), 0);

  if (lastMonthTotal > 0) {
    const pctChange = ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100;
    if (Math.abs(pctChange) >= 10) {
      const direction = pctChange > 0 ? "up" : "down";
      insights.push({
        tag: "Trend",
        text: `You're spending ${direction} ${Math.abs(pctChange).toFixed(0)}% compared to last month (₱${thisMonthTotal.toFixed(2)} so far vs ₱${lastMonthTotal.toFixed(2)}).`,
      });
    }
  } else if (thisMonthTotal > 0) {
    insights.push({
      tag: "Trend",
      text: `₱${thisMonthTotal.toFixed(2)} spent so far this month — last month has no recorded expenses to compare against yet.`,
    });
  }

  // --- Top category this month -------------------------------------------
  const thisMonthExpenses = expenses.filter((e) => e.expense_date.startsWith(thisMonthPrefix));
  if (thisMonthExpenses.length) {
    const byCategory = {};
    for (const e of thisMonthExpenses) byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount);
    const [topCategory, topAmount] = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
    const share = thisMonthTotal > 0 ? (topAmount / thisMonthTotal) * 100 : 0;
    if (share >= 30) {
      insights.push({
        tag: "Category",
        text: `${topCategory} is your biggest category this month at ₱${topAmount.toFixed(2)} — ${share.toFixed(0)}% of everything you've spent.`,
      });
    }
  }

  // --- Biggest single expense this month -----------------------------------
  if (thisMonthExpenses.length) {
    const biggest = [...thisMonthExpenses].sort((a, b) => Number(b.amount) - Number(a.amount))[0];
    if (Number(biggest.amount) >= avgDaily * 2 && Number(biggest.amount) > 0) {
      const d = new Date(biggest.expense_date + "T00:00:00");
      insights.push({
        tag: "Standout",
        text: `Your biggest expense this month was ₱${Number(biggest.amount).toFixed(2)} on ${escapeForInsight(biggest.description || biggest.category)} (${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}).`,
      });
    }
  }

  // --- Weekday vs weekend pattern -------------------------------------------
  let weekdayTotal = 0, weekdayCount = 0, weekendTotal = 0, weekendCount = 0;
  for (const e of expenses) {
    const day = new Date(e.expense_date + "T00:00:00").getDay();
    const isWeekend = day === 0 || day === 6;
    if (isWeekend) { weekendTotal += Number(e.amount); weekendCount++; }
    else { weekdayTotal += Number(e.amount); weekdayCount++; }
  }
  if (weekdayCount >= 3 && weekendCount >= 2) {
    const weekdayAvg = weekdayTotal / weekdayCount;
    const weekendAvg = weekendTotal / weekendCount;
    if (weekendAvg > weekdayAvg * 1.4) {
      insights.push({
        tag: "Pattern",
        text: `You spend noticeably more per transaction on weekends (avg ₱${weekendAvg.toFixed(2)}) than on weekdays (avg ₱${weekdayAvg.toFixed(2)}).`,
      });
    } else if (weekdayAvg > weekendAvg * 1.4) {
      insights.push({
        tag: "Pattern",
        text: `Weekdays are where most of your spending happens — avg ₱${weekdayAvg.toFixed(2)} per transaction vs ₱${weekendAvg.toFixed(2)} on weekends.`,
      });
    }
  }

  if (insights.length === 0) {
    insights.push({
      tag: "Steady",
      text: "Nothing unusual to flag — your spending looks fairly steady. Keep logging expenses and insights will get sharper over time.",
    });
  }

  return insights.slice(0, 5);
}

function escapeForInsight(str) {
  return String(str || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}
