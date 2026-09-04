function formatTodayLine(completed, goal, date, localToday) {
  var count = String(completed)
  var positiveGoal = Number(goal || 0)
  var value = positiveGoal > 0 ? count + " / " + positiveGoal : count
  var shownDate = String(date || "")
  var today = String(localToday || "")
  if (shownDate === today && today !== "") return value + " today"
  if (shownDate !== "") return value + " · " + shownDate
  return value
}

// CommonJS keeps the same helper executable in the lightweight Python tests.
if (typeof module !== "undefined") module.exports = { formatTodayLine: formatTodayLine }
