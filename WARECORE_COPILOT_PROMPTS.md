# WareCore Copilot — Example Prompts

## What it can do today

WareCore Copilot is the AI chat assistant built into WareCore, available from the chat tab docked to the edge of the screen. Right now it can help with two things:

- Finding an item in your catalog from a rough description — item code, item name, material type, or size, even when the wording isn't exact.
- Looking up the full stock ledger for a single item over a date range — opening balance, every transaction (purchases, sales, job work, transfers), and the closing balance.

More capabilities (purchases, sales, transfers, and job work as their own topics) are planned for later phases. For now, ask it questions shaped like the examples below and it will find the right item and pull the numbers for you.

## Finding an item

- Find items matching 0.70X1000
- What items do we have in Cold Rolled 0.90X1220?
- Look up item code CR00066
- Search for GI 1.20X1210
- Do we carry HR 2.5MM X 1250?

## Item ledger — stock and transaction history

- What's the ledger for GI 1.20X1210 from 1st Jan to 31st Mar 2024?
- Show me all transactions for CR 0.90X1220 this month.
- What was the opening balance for CR00066 on 1st May 2024?
- Give me the closing balance for GP 0.60X1000 as of today.
- How much CR 0.70X1710 stock moved between April and June 2024?
- Show the stock ledger for HR 2.5MM X 1250 for the last 30 days.
- Was there any purchase-in for GI 1.20X1210 in March 2024?

## Tips

- Mention the material type and size together (e.g. "Cold Rolled 0.90X1220") — the same size often exists across several material types, so combining details helps the Copilot find the right item on the first try.
- If a search matches more than one item, the Copilot will list the candidates and ask which one you meant instead of guessing.
- Dates can be written naturally ("1st Jan 2024", "last month") — the Copilot will convert them.
