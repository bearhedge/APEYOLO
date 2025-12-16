---
description: Capture debugging lessons // Post-mortem analysis
---

# Troubleshooting Retrospective

After this debugging session, analyze and extract lessons learned:

## Questions to Answer
1. **What was the root cause?** - The actual technical issue
2. **Why did it take time?** - What assumptions or gaps delayed finding it
3. **Faster path?** - What question/check would have found it immediately
4. **Pattern match** - What category of bug is this (data format, terminology, calculation, etc.)

## Action
Append a generalized lesson to `.claude/troubleshooting-tips.md` in this format:

### [Category] - [Short Title]
- **Symptom:** What the user reported seeing
- **Root Cause:** The underlying technical issue
- **Fast Path:** The question/check to identify this pattern quickly
- **Prevention:** How to avoid this in future code
