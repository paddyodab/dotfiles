---
allowed-tools: Bash
---

# Check Inbox

Read the AgentMail research inbox and present a research queue.

## Inbox Data

!`curl -s -H "Authorization: Bearer $AGENTMAIL_API_KEY" "https://api.agentmail.to/v0/inboxes/paddy-research@agentmail.to/messages" 2>&1`

## Instructions

1. Parse the inbox data above
2. Filter to messages with the "unread" label
3. Present a numbered list showing:
   - Subject line
   - Date/time received
   - Preview text (first line or link if present)
4. If there are no unread messages, say "Inbox is empty — nothing queued up."
5. Ask which item to research first
6. When the user picks one, fetch the full message if needed, then:
   - If it contains a URL: open it with Claude-in-Chrome or WebFetch and start critical evaluation
   - If it contains a question or topic: start researching directly
   - Apply the evaluation framework from .claude/SELF.md (critical assessment first, pain-point filter)
7. After reading a message, mark it as read by removing the "unread" label. **Important:** message IDs contain angle brackets and `@` — URL-encode them first:
   ```bash
   MSG_ID=$(python3 -c "import urllib.parse; print(urllib.parse.quote('{messageId}', safe=''))")
   curl -s -X PATCH -H "Authorization: Bearer $AGENTMAIL_API_KEY" -H "Content-Type: application/json" \
     -d '{"remove_labels": ["unread"]}' \
     "https://api.agentmail.to/v0/inboxes/paddy-research@agentmail.to/messages/$MSG_ID"
   ```
