# Troubleshooting Tips

Lessons learned from debugging sessions. Check this document before deep-diving into issues - the answer may already be here.

---

### [Data Format] - Currency Already Converted
- **Symptom:** Numbers appear ~7-8x too large or too small (e.g., -75,711 instead of -9,706)
- **Root Cause:** API returns data in one currency (e.g., HKD), but UI applies another conversion
- **Fast Path:** Ask: "What currency does the API return this value in?" Check API logs for raw values.
- **Prevention:** Add comments documenting the currency of each API field; name variables with currency suffix (e.g., `dayPnlHKD`)

---

### [Terminology] - Domain Terms Have Multiple Meanings
- **Symptom:** User says a metric is "wrong" but the calculation looks correct
- **Root Cause:** Finance/trading terms like "Margin Used" mean different things (requirement vs borrowed amount)
- **Fast Path:** Ask: "What does this metric mean to YOU?" before debugging the calculation
- **Prevention:** Use unambiguous labels (e.g., "Margin Requirement" vs "Margin Loan"); add tooltips explaining each metric

---

### [Calculation] - Hidden Assumptions Not Visible to User
- **Symptom:** User questions calculation accuracy, multiple iterations to get it right
- **Root Cause:** Assumptions (interest rates, formulas) are hidden in code, user can't verify
- **Fast Path:** Show formula/assumptions in the UI (e.g., "~$50/day at 6.5% rate")
- **Prevention:** Display calculation details, use ~ prefix for estimates, show (N days) context

---

### [Display] - Per-Unit vs Total Confusion
- **Symptom:** Numbers like "Delta: 400" when user expects "Delta: 1.00"
- **Root Cause:** Code shows total position value instead of per-share/per-contract value
- **Fast Path:** Ask: "Should this show per-share or total position?"
- **Prevention:** Column headers should clarify (e.g., "Delta/Share" vs "Total Delta"); be consistent across similar metrics

---
<!-- Add new entries above this line -->

