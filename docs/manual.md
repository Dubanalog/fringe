# Fringe User Manual

Fringe is a budgeting app for film and television. You build a budget the way it's laid out on
paper: a topsheet of categories, accounts inside each category, and detail lines inside each
account. Fringe works out the totals, the fringes and the reports, and keeps every change so you
can always go back.

Everything stays on your computer. A budget is a folder of plain files you own, and nothing is
sent anywhere unless you turn on the AI and ask it something.

---

## 1. Getting started

### Installing

Download the installer for your computer from the project's Releases page.

| Computer                      | Download                                                         |
| ----------------------------- | ---------------------------------------------------------------- |
| Windows (most PCs)            | `Fringe-…-win-x64.exe`                                           |
| Windows on ARM (e.g. Surface) | `Fringe-…-win-arm64.exe`                                         |
| Mac with Apple Silicon (M1+)  | `Fringe-…-mac-arm64.dmg`                                         |
| Mac with an Intel chip        | `Fringe-…-mac-x64.dmg`                                           |
| Ubuntu, Debian, Mint          | `.deb`                                                           |
| Fedora, RHEL, openSUSE        | `.rpm`                                                           |
| Any other Linux               | `.AppImage` (make it executable, then double-click) or `.tar.gz` |

The Windows installer isn't signed yet, so Windows may show a blue "Windows protected your PC"
box the first time. Click **More info**, then **Run anyway**.

### The start page

When no budget is open, the start page offers:

- **New budget:** type the show's name and click **Create**.
- **Open project** (Ctrl+O): a budget folder already on this computer.
- **Import .fringe file** (Ctrl+I): a budget someone sent you.
- **Convert a budget:** one made in another program; the AI converts it (section 9).
- **Recent:** the budgets you've opened lately.

Each open budget gets its own tab across the top, like a web browser. Ctrl+Tab moves between them.

### Where budgets are kept

Each budget is a folder, by default in `Documents/Fringe Budgets`. The folder holds the budget,
its full history, PDFs of saved versions and its knowledge files (see section 8). You can copy,
back up or move the folder and open it again with **Open**.

To send a budget to someone, click **Export…** to save it as a **`.fringe` file**: the whole folder in one file.
They open it with **Import**.

### Saving

There is no Save button. Every change is saved the moment you make it, and every change can be
undone (section 7).

---

## 2. The screen

- **Left sidebar:** the main pages. **Budget**, **Budget Settings**, **Reports**, **Crew List**,
  **Knowledge**, **History**, **AI** and **Add-ons**, with **Settings** at the bottom.
- **Tabs across the top:** one per open budget.
- **AI button** (top right, Ctrl+J): opens the AI panel beside the budget (section 9).
- **Breadcrumbs:** where you are in the budget (Topsheet › 3300 Camera › …), with Back and
  Forward buttons (Alt+← and Alt+→), just like a browser.
- **Bottom bar:** the keyboard hints for the page you're on.

---

## 3. Building a budget

A budget has three levels:

1. **Topsheet:** one row per category, with its total, then the fringe rows, percentages
   (contingency, fees) and tax incentives, and the grand total.
2. **Category:** the accounts in one category, e.g. 3300 Camera.
3. **Account:** the detail lines, the actual figures.

Open a row by clicking the **›** at its left, pressing **Ctrl+Enter**, or double-clicking it
(choose Edit or Open for double-click in the toolbar). **Ctrl+PgUp / Ctrl+PgDn** moves to the
previous or next category or account without going back up.

### Working in the grid

The grid works like a spreadsheet:

| To                      | Do this                           |
| ----------------------- | --------------------------------- |
| Edit a cell             | Start typing, or press F2 / Enter |
| Cancel an edit          | Esc                               |
| Add a row below / above | Ins / Shift+Ins                   |
| Delete a row            | Ctrl+Del                          |
| Select several lines    | Shift+click or Ctrl+click         |
| Copy / paste            | Ctrl+C / Ctrl+V                   |
| More options            | Right-click a row                 |

### Detail lines

Each line is **Amount × X × Rate = Subtotal**:

- **Description:** what it is ("Director of Photography").
- **Amount:** how many units (e.g. 10 for ten weeks).
- **Unit:** what the amount counts: days, weeks, hours, flat, allow. Set up in Budget Settings › Units.
- **X:** a multiplier, e.g. 2 people or 1.5 for time and a half. Leave it blank for 1.
- **Rate:** the cost per unit.
- **Subtotal:** worked out for you.
- **Fringes:** which fringes apply to this line (payroll taxes, union benefits). The Fringe % column
  shows what they add as a percentage of the line.
- **Groups**, **Set**, **Location** and the code columns: tags for reports and tax incentives.
- **Currency:** for lines budgeted in another currency (section 4).

Any number can be a **formula** (`11*1.5`, `5000/2`) or use a **global**: a named number such as
`SHOOT` for shoot days. Change the global once and every line that uses it updates.

**Show or hide columns** with the **Columns ▾** button above the lines; drag a heading to move a
column. **Show globals** shows the global behind a number (`SD`) instead of its value. Blank lines
and note lines are fine; they add nothing.

### Copying from Excel

Select cells in Excel, Google Sheets or Numbers, copy, click a cell in Fringe and press Ctrl+V.
Each row becomes a line and each column goes into the column you pasted at and the ones to its
right. If you copied whole rows with the same columns as Fringe, they line up from the first
column. Dollar signs, commas and brackets for negatives are cleaned up for you. Anything that
won't go in (a word in the Rate column, say) is left out, and Fringe tells you which cells.

Copying works the other way too: select lines, press Ctrl+C and paste into a spreadsheet.

---

## 4. Budget Settings

Each budget has its own settings, in tabs:

- **General:** the title, the production's details, rounding and how many decimals to show.
- **Chart of Accounts:** your categories and accounts, their numbers and production levels
  (Above-the-Line, Below-the-Line, Post, Other).
- **Units:** day, week, hour and so on, and how many hours each one is (used by fringes charged
  per hour).
- **Currencies:** the budget's own currency, and any others, each with its rate: what one unit is
  worth in the budget's currency (e.g. 1 CAD = 0.73 USD). A line in another currency shows its
  own figures; totals, fringes and reports convert it. Change a rate and every total follows.
- **Groups:** named groups of lines, for reports and tax incentives. A group can have a color.
- **Fringes:** see section 5.
- **Globals:** named numbers and formulas used in lines.
- **Percentages:** amounts worked out on the topsheet as a percentage of some or all of the
  budget, such as contingency, completion bond or production fee. Use a minus to take something off.
- **Codes:** the lists behind the Set, Location and code columns.
- **Assumptions:** a notes page for the budget's assumptions, with basic formatting. It can go on
  the reports.

---

## 5. Fringes

A fringe is a cost charged on top of wages: payroll taxes, pension, health, vacation pay.

### Setting up a fringe

In **Budget Settings › Fringes**, each fringe has:

- a **name** and **description**,
- a **kind:** a percentage of pay, or a flat amount per unit (e.g. per hour),
- a **rate**,
- a **cutoff** (optional): the most pay per person it's charged on, for capped taxes.

Then give a line its fringes in the line's **Fringes** column.

### Where fringes show

Choose how fringes post:

- **Each account:** in the Fringes column of the account they come from.
- **One account per category:** each category has a fringe account (e.g. 3399 in 3300 Camera)
  that collects the category's fringes. The other accounts show their own fringes greyed, with
  "→ 3399", so you can see where they went; they aren't added twice.
- **One account per production level:** a fringe row per level on the topsheet.
- **One account for the whole budget:** one fringe row at the bottom of the topsheet.

### Cutoffs and fringe ranges

A cutoff applies to each person. When one person is paid over several lines (prep and shoot, or
a rate change), put those lines in one **fringe range** so the cutoff is used up across them
instead of starting again on each line. Drag down the **Range** column across those lines to draw
one; the column shows which lines belong together.

### Your rate library

Fringe doesn't come with any rates: there's no public rate sheet, and rates change every year.
Instead, you keep your own library of rates and add them to any budget.

- **Save These to Library** (Budget Settings › Fringes) copies the budget's fringes into the
  library, dated today and noted with the budget's name.
- **Settings › Fringe Rates** is the library itself. Type rates in from your payroll company's or
  union's sheet, with the date they're right as of and where they came from.
- **Export Rates…** saves the library as a file to send to a colleague; **Import Rates…** adds
  theirs to yours. A rate with the same name as one you have replaces it.
- **Add from Library…** (Budget Settings › Fringes) lists the library; tick the rates you want and
  click **Add to Budget**. Where the budget already has a fringe of that name, it takes the
  library's rate, and its lines keep it.

Adding rates copies them: changing the library later never changes a budget.

---

## 6. Reports

The **Reports** page builds:

- **Topsheet:** categories and totals.
- **Changes:** what changed since a saved version.
- **Account Summary:** every account with its total.
- **Detail:** every account with its lines, fringes and totals.
- **Crew List:** the budget's labor on one page.
- **Fringes:** each fringe and what it adds up to.
- **Globals**, **Groups**, **Sets** and **Locations:** totals by each.
- **Assumptions:** the assumptions page.

Choose the reports and options (levels to include, hide zero lines, fringes per line or rolled up,
portrait or landscape), check the preview, then **Save PDF**, **Save Excel** or **Save JSON**.

---

## 7. History and versions

### Undo and redo

**Ctrl+Z** undoes and **Ctrl+Y** redoes (⌘Z and ⇧⌘Z on a Mac). Nothing is ever lost: if you
undo and then make a different change, the old path is kept as a branch in History.

### The History page

**History** lists every change, newest first: what changed, where, and when. Click any entry to go
back to the budget as it was then. Changes the AI made are marked.

### Versions

When a draft goes out, save it as a **version** (v1, v2 …) with a name and notes. Fringe saves a
PDF of it in the budget's `versions` folder and drafts the notes for you from the changes since
the last version. Compare any two versions to see what moved, account by account, or run the
**Changes** report against one.

---

## 8. Knowledge

**Knowledge** is where a budget's reference material lives: rate sheets, union agreements, deal
memos, schedules, and **instructions**: your rules and decisions for this production ("10-hour
days", "use the 2026 rates"). The AI reads the instructions first.

Knowledge for every budget (house rules, your usual rate sources) goes in **Settings › Global
Knowledge**.

---

## 9. AI

The AI is optional. It can answer questions about the budget, make changes you describe, explain
a total, draft version notes, or convert a budget from another program.

### Turning it on

Open the AI panel (Ctrl+J) or the **AI** page and choose how to connect:

- **Claude Code**, if it's installed and you're signed in to your Claude plan.
- **An API key** from an AI company. You type the key yourself; it's stored encrypted on this
  computer.
- **Another AI app** that supports MCP, connected using the details on the AI page.

### What it can and can't do

The AI works through the same tools you do. Every change it makes is a normal history entry you
can see and undo, and it asks before changing anything you haven't asked for. It only sees a
budget when you ask it something, and only through the AI company you chose.

### Bringing in a budget from another program

Export the budget from the other program as PDF, Excel, CSV or XML, add the file to the budget's
Knowledge, and ask the AI to convert it. It builds the budget line by line, works out what the
file doesn't say (globals, unit hours, fringe cutoffs), then shows the **Import Report**: the
file's totals next to Fringe's, with any account that doesn't match and why. Check what it marked
as worked out, and answer its questions.

---

## 10. Add-ons

Add-ons are extra pages built on a budget, such as a cash flow or a hiring plan. Ask the AI to make
one ("make me a weekly cash flow from the shoot schedule"); it appears under **Add-ons** in the
sidebar. Add-ons read the budget; they don't change it.

---

## 11. Settings

**Settings** (bottom of the sidebar) holds what applies to the whole app: the appearance (light,
dark and color themes), your fringe rate library (see section 5), Global Knowledge, and the
version you're running.

---

## Keyboard shortcuts

On a Mac, use ⌘ where it says Ctrl (except Ctrl+Tab).

| Shortcut              | Action                              |
| --------------------- | ----------------------------------- |
| Ctrl+O                | Open a budget folder                |
| Ctrl+I                | Import a .fringe file               |
| Ctrl+Tab              | Next budget tab                     |
| Ctrl+J                | Open or close the AI panel          |
| Ctrl+Enter            | Open the selected row               |
| Alt+← / Alt+→         | Back / forward                      |
| Ctrl+PgUp / Ctrl+PgDn | Previous / next category or account |
| F2, Enter or typing   | Edit a cell                         |
| Esc                   | Cancel an edit                      |
| Ins / Shift+Ins       | Add a row below / above             |
| Ctrl+Del              | Delete a row                        |
| Ctrl+C / Ctrl+V       | Copy / paste                        |
| Ctrl+Z / Ctrl+Y       | Undo / redo                         |

---

Fringe is free software under the AGPL-3.0 license, and is an independent project.
