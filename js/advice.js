/**
 * Rule-based "smart advice" — no external AI call, just pattern rules
 * over the user's own recent data.
 *
 * @param {object} today - { total, done, missed, pending, doneMinutes, missedMinutes }
 * @param {Array}  recentLogs - flattened logs from the last 7 days, each:
 *   { log_date, status, routine_id, title, time, duration_minutes }
 * @param {Array}  routines - current active routine templates
 * @returns {Array<{tag: string, text: string}>}
 */
export function generateAdvice(today, recentLogs, routines) {
  const advice = [];

  if (routines.length === 0) {
    return [
      {
        tag: "Get started",
        text: "You haven't added any time blocks yet. Head to My Routine and lay out your day — even 3 or 4 anchors like wake-up, work start, and wind-down is enough to begin.",
      },
    ];
  }

  const totalToday = today.total || 0;
  const completionToday = totalToday ? Math.round((today.done / totalToday) * 100) : null;

  // --- Today's performance -------------------------------------------
  if (completionToday !== null) {
    if (completionToday >= 90) {
      advice.push({
        tag: "Today",
        text: `Strong day — ${completionToday}% completed. Keep the same wake-up and start-of-day timing tomorrow; that's usually what carries a good streak.`,
      });
    } else if (completionToday <= 40 && today.done + today.missed > 0) {
      advice.push({
        tag: "Today",
        text: `Only ${completionToday}% completed today. Rather than trying to fix the whole day tomorrow, pick just the first 2 blocks of the morning and protect those — the rest tends to follow.`,
      });
    }
  }

  // --- Most-missed routine over the last 7 days -----------------------
  const missCounts = {};
  const doneCounts = {};
  for (const log of recentLogs) {
    if (log.status === "missed") missCounts[log.title] = (missCounts[log.title] || 0) + 1;
    if (log.status === "done") doneCounts[log.title] = (doneCounts[log.title] || 0) + 1;
  }
  const worst = Object.entries(missCounts).sort((a, b) => b[1] - a[1])[0];
  if (worst && worst[1] >= 3) {
    advice.push({
      tag: "Pattern",
      text: `"${worst[0]}" has been missed ${worst[1]} times in the last week — the most of any block. Consider moving it earlier, shortening it, or pairing it right after something you already do reliably.`,
    });
  }

  // --- Morning vs evening miss concentration ---------------------------
  let morningMiss = 0, eveningMiss = 0, morningTotal = 0, eveningTotal = 0;
  for (const log of recentLogs) {
    const hour = Number((log.time || "0:0").split(":")[0]);
    const isMorning = hour < 12;
    if (isMorning) morningTotal++; else eveningTotal++;
    if (log.status === "missed") {
      if (isMorning) morningMiss++; else eveningMiss++;
    }
  }
  const morningRate = morningTotal ? morningMiss / morningTotal : 0;
  const eveningRate = eveningTotal ? eveningMiss / eveningTotal : 0;
  if (morningTotal >= 4 && eveningTotal >= 4) {
    if (morningRate > eveningRate + 0.15) {
      advice.push({
        tag: "Pattern",
        text: "Mornings are where things slip most this week. A short buffer before the first block, or preparing the night before, usually helps more than adding willpower.",
      });
    } else if (eveningRate > morningRate + 0.15) {
      advice.push({
        tag: "Pattern",
        text: "Evenings are where things slip most this week — likely fatigue or the day running long. Try trimming the number of evening blocks rather than the morning ones.",
      });
    }
  }

  // --- Streak of good days ---------------------------------------------
  const byDate = {};
  for (const log of recentLogs) {
    if (!byDate[log.log_date]) byDate[log.log_date] = { done: 0, total: 0 };
    byDate[log.log_date].total++;
    if (log.status === "done") byDate[log.log_date].done++;
  }
  const dates = Object.keys(byDate).sort().reverse();
  let streak = 0;
  for (const d of dates) {
    const rate = byDate[d].total ? byDate[d].done / byDate[d].total : 0;
    if (rate >= 0.8) streak++;
    else break;
  }
  if (streak >= 3) {
    advice.push({
      tag: "Momentum",
      text: `You've kept at least 80% completion for ${streak} days in a row. This is usually when it's safe to add one more block if there's something you've been putting off.`,
    });
  }

  // --- Pending items still open today -----------------------------------
  if (today.pending > 0 && today.done + today.missed > 0) {
    advice.push({
      tag: "Today",
      text: `${today.pending} block${today.pending === 1 ? "" : "s"} still unmarked today. Mark them as done or missed before the day ends so tomorrow's advice stays accurate.`,
    });
  }

  // --- Fallback if nothing else triggered ---------------------------------
  if (advice.length === 0) {
    advice.push({
      tag: "Steady",
      text: "Not enough of a pattern yet to call out — keep logging each block daily and advice will get sharper after a few more days of data.",
    });
  }

  return advice.slice(0, 4);
}
