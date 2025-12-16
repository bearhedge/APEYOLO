---
description: Generate context for next session // Seamless continuation
---

# Session Handoff

Generate a comprehensive prompt for continuing this work in a new Claude Code session.

## Include in the Handoff
1. **Context Summary** - What we worked on, current state of the codebase
2. **Key Files Modified** - Paths with brief description of changes
3. **Technical Decisions** - Why we chose certain approaches
4. **Current State** - What's working, what's deployed, what's pending
5. **Next Steps** - Specific action items to continue
6. **Watch Out For** - Gotchas, known issues, things to remember

## Format
Output as a ready-to-paste prompt that starts with:
"Continue work on [PROJECT]. Here's the context from the previous session..."
