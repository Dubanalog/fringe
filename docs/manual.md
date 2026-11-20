# Fringe User Manual

Fringe is a budgeting app for film and television. It works out the totals, the payroll costs and
the reports for you, and keeps every change so you can always go back.

Everything stays on your computer. A budget is a folder of plain files you own, and nothing is
sent anywhere unless you turn on the AI and ask it something.

This manual assumes you've never built a film or TV budget. Section 1 explains how one works. If
you already know, skip to section 2. Words in **bold** that are specific to the industry are also in
the [Glossary](#glossary) at the end.

---

## Contents

1. [Film and TV budgets in brief](#1-film-and-tv-budgets-in-brief)
2. [Getting started](#2-getting-started)
3. [The screen](#3-the-screen)
4. [Building a budget](#4-building-a-budget)
5. [Budget Settings](#5-budget-settings)
6. [Fringes](#6-fringes)
7. [Percentages and tax incentives](#7-percentages-and-tax-incentives)
8. [Reports](#8-reports)
9. [Crew List](#9-crew-list)
10. [History and versions](#10-history-and-versions)
11. [Knowledge](#11-knowledge)
12. [AI](#12-ai)
13. [Add-ons](#13-add-ons)
14. [Settings](#14-settings)
15. [Keyboard shortcuts](#keyboard-shortcuts)
16. [Glossary](#glossary)

---

## 1. Film and TV budgets in brief

A production budget is a list of everything a film or show will cost, from buying the script to
delivering the finished picture. It's usually built by a production accountant or line producer,
long before shooting starts, and it changes many times as the script, the schedule and the money
change.

### The three levels

Every film budget has the same shape, from the top down:

1. **Topsheet:** a one-page summary. One row per **category** (Camera, Wardrobe, Locations…)
   with its total, then the extra amounts worked out on the whole budget (payroll costs,
   contingency, tax credits), and the **grand total**. This is the page producers and studios read
   first.
2. **Category:** a department or area of cost, made up of **accounts**. The Camera category might
   hold accounts for the camera crew, camera rentals and camera purchases.
3. **Account:** the detail, made of **lines**. Each line is one cost: "Director of Photography,
   10 weeks at $8,000 a week", or "Camera package rental, 40 days at $2,500 a day".

Categories and accounts are numbered, such as category 3300 Camera and account 3301 Director of
Photography. The list of numbers and names is the **chart of accounts**. Studios and production
companies each have their own, so that every budget they see is laid out the same way.

### Above and below the line

The categories are grouped into **production levels**, which show as subtotals on the topsheet:

- **Above-the-line** (ATL): the key creative people, who are often negotiated individually:
  writers, producers, the director and the main cast, and the rights to the story.
- **Below-the-line** (BTL): everyone and everything else needed to shoot. That covers the crew,
  equipment, sets, locations, travel and catering.
- **Post-production:** editing, visual effects, music and sound, after shooting.
- **Other:** insurance, legal, publicity and general costs.

### Time: prep, shoot and wrap

Most costs depend on time. A production has **prep** (getting ready), the **shoot** (filming
days), and **wrap** (returning gear, closing the books). A crew member might be budgeted for
2 weeks of prep, 6 weeks of shooting and 1 week of wrap, each a separate line, all at the same
weekly rate. That's why budgets use **globals**, such as a named number for "shoot days". Change
the schedule once and every line that uses it follows.

### Fringes

When you pay someone wages, you also pay costs on top of those wages: employer payroll taxes,
union pension and health contributions, vacation and holiday pay, workers' compensation insurance.
These are called **fringes** (short for fringe benefits). On a film they can add 20% to 40% or
more to the cost of labor, so they matter.

Fringes are set as rates, either a percentage of wages or a flat amount per hour or day. Some stop
once a person has earned a certain amount in the year; that limit is the **cutoff**. Rates differ
by union, state or country and year, and they change often. Fringe doesn't come with any rates.
You enter the ones that apply to your production (section 6).

### Amounts on the whole budget

Some costs are worked out from the budget itself rather than line by line:

- **Contingency:** a cushion for the unexpected, often a percentage of the budget.
- **Completion bond:** insurance that guarantees the film gets finished, priced as a percentage.
- **Production fees** and overhead.
- **Tax incentives:** many states and countries give back part of what you spend there, as a tax
  credit or rebate. They're usually shown below the grand total to give a **net cost**.

### Versions

A budget goes through many drafts. Each time one goes to a studio, a financier or the bond
company, it's saved as a **version** (v1, v2…). Later, people will ask what changed between
versions: "the studio cut $1M; where did it come from?" Fringe keeps every version and can compare
any two (section 10).

---

## 2. Getting started

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
- **Convert a budget:** one made in another program; the AI converts it (section 12).
- **Recent:** the budgets you've opened lately.

Each open budget gets its own tab across the top, like a web browser. Click **+** to open another,
Ctrl+Tab moves between them, and double-clicking a tab (or F2) renames the budget.

### Where budgets are kept

Each budget is a folder, by default in `Documents/Fringe Budgets`. The folder holds the budget,
its full history, PDFs of saved versions and its knowledge files (section 11). You can copy,
back up or move the folder and open it again with **Open project**.

The bar at the bottom of the window shows whether the budget is saved, with two buttons:

- **Show Folder** opens the budget's folder.
- **Export…** saves the whole budget as one **`.fringe` file**, to send to someone or keep as a
  backup. They open it with **Import .fringe file**.

### Saving

There is no Save button. Every change is saved the moment you make it ("Saved" in the bottom bar),
and every change can be undone (section 10).

### Help

The **Help** menu opens this manual, the project's page, and a form to report a problem.

---

## 3. The screen

- **Left sidebar:** the main pages: **Budget**, **Budget Settings**, **Reports**, **Crew List**,
  **Knowledge**, **History**, **AI** and **Add-ons**, with **Settings** at the bottom.
- **Tabs across the top:** one per open budget.
- **AI button** (top right, Ctrl+J): opens the AI panel beside the budget (section 12).
- **Breadcrumbs:** where you are in the budget (Topsheet › 3300 Camera › …), with Back and
  Forward buttons (Alt+← and Alt+→), just like a browser.
- **Bottom bar:** keyboard hints for the page you're on, whether the budget is saved, and the
  **Show Folder** and **Export…** buttons.

---

## 4. Building a budget

The **Budget** page shows the three levels from section 1:

1. **Topsheet:** one row per category, with its total, then the production level subtotals, the
   fringe rows, percentages (section 7) and tax incentives, and the grand total.
2. **Category:** the accounts in one category, e.g. 3300 Camera.
3. **Account:** the detail lines, the actual figures.

Open a row by clicking the **›** at its left, pressing **Ctrl+Enter**, or double-clicking it. The
toolbar sets what a double-click on the number or description does: **Edit** the cell or
**Open** the row. **Ctrl+PgUp / Ctrl+PgDn**, or the buttons at the top, move to the previous or
next category or account without going back up.

To start, add categories on the topsheet and accounts in each category, or set up the whole chart
of accounts at once in Budget Settings (section 5). If you already have a budget in another
program, the AI can convert it for you (section 12).

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
- **Unit:** what the amount counts: days, weeks, hours, **flat** (a fixed fee) or **allow** (an
  allowance, a set amount). Set up in Budget Settings › Units.
- **X:** a multiplier, e.g. 2 for two people, or 1.5 for time and a half. Leave it blank for 1.
- **Rate:** the cost per unit.
- **Subtotal:** worked out for you.
- **Fringes:** which fringes apply to this line (section 6). The **Fringe %** column shows what
  they add as a percentage of the line.
- **Groups**, **Set**, **Location** and the code columns: tags for reports and tax incentives.
  A **set** is a place built or dressed for filming ("Kitchen", "Spaceship bridge"); a **location**
  is a real place you film at.
- **Range:** groups one person's lines for fringe cutoffs (section 6).
- **Currency:** for lines budgeted in another currency (section 5).

Any number can be a **formula** (`11*1.5`, `5000/2`) or use a **global**: a named number such as
`SHOOT` for shoot days. Change the global once and every line that uses it updates.

**Show or hide columns** with the **Columns ▾** button above the lines; drag a heading to move a
column. **Show globals** shows the global behind a number (`SHOOT`) instead of its value. Blank lines
and note lines are fine; they add nothing.

### The line panel

Select one or more lines to see them in the panel beside the grid: the subtotal, the fringes and
the total, with tick boxes to give the selected lines fringes and groups, or put them in a fringe
range, all at once.

Under the lines, the account shows its fringes: each one, its rate, what it applies to, its cutoff
and what it comes to.

### Copying from Excel

Select cells in Excel, Google Sheets or Numbers, copy, click a cell in Fringe and press Ctrl+V.
Each row becomes a line and each column goes into the column you pasted at and the ones to its
right. If you copied whole rows with the same columns as Fringe, they line up from the first
column. Dollar signs, commas and brackets for negatives are cleaned up for you. Anything that
won't go in (a word in the Rate column, say) is left out, and Fringe tells you which cells.

Copying works the other way too: select lines, press Ctrl+C and paste into a spreadsheet.

---

## 5. Budget Settings

**Budget Settings** applies to the budget in front of you only. It has these tabs:

- **General:**
  - The budget's name.
  - The **report title** printed on every report.
  - The theme (which applies to every budget).
  - **Show money as** dollars and cents, or whole dollars.
  - **Calculation rounding:** round each line to cents, or keep full precision.
  - **Show tax incentives:** under the grand total with a Net Cost line, or taken off the grand
    total (section 7).
- **Chart of Accounts:**
  - How category and account numbers look. Type a pattern with `#` for each digit: `####` is
    1102, `##-##` is 11-02. Changing the pattern renumbers everything, in one step you can undo.
  - The **production totals** (Above-the-Line, Below-the-Line, Post, Other). A category belongs to
    the total with the highest starting number at or below its own.
- **Units:** day, week, hour and so on, and how many hours each one is (used by fringes charged
  per hour). A 10-hour day and a 50-hour week are common.
- **Currencies:** the budget's own currency, and any others, each with its rate: what one unit is
  worth in the budget's currency (e.g. 1 CAD = 0.73 USD). A line in another currency shows its
  own figures; totals, fringes and reports convert it. Change a rate and every total follows.
- **Groups:** named groups of lines, for reports and tax incentives, e.g. "Georgia spend" or
  "Second unit". A group can have a color.
- **Fringes:** section 6.
- **Globals:** named numbers and formulas used in lines, each with a description, such as
  `SHOOT` = 30 shoot days, or `WEEKS` = `SHOOT/5`.
- **Percentages:** contingency, fees and tax incentives (section 7).
- **Codes:** the lists behind the Set, Location and code columns.
- **Assumptions:** a notes page for what the budget assumes: shoot days, locations, union
  agreements, which rates. It has basic formatting and can print with the reports. The AI can draft
  it for you.

---

## 6. Fringes

A fringe is a cost charged on top of wages (section 1): payroll taxes, pension, health, vacation
pay, workers' compensation.

### Setting up a fringe

In **Budget Settings › Fringes**, each fringe has:

- a **name** and **description**,
- a **kind:** a percentage of pay, or a flat amount per unit (e.g. per hour),
- a **rate**,
- a **cutoff** (optional): the most pay per person it's charged on, for taxes that stop at a
  yearly limit.

Then give a line its fringes in the line's **Fringes** column or in the line panel.

### Where fringes show

Choose where fringes post:

- **Each account:** in the Fringes column of the account they come from.
- **One account per category:** each category has a fringe account (e.g. 3399 in 3300 Camera)
  that collects the category's fringes. The other accounts show their own fringes greyed, with
  "→ 3399", so you can see where they went; they aren't added twice. Set which number the fringe
  account ends in; a category without one keeps its fringes on each account, and the budget page
  warns you.
- **One account per production level:** a fringe row per level on the topsheet.
- **One account for the whole budget:** one fringe row at the bottom of the topsheet.

Wherever they post, the account they land in lists each fringe, the rate, what it was charged on
and where it came from.

### Cutoffs and fringe ranges

A cutoff applies to each person. When one person is paid over several lines (prep and shoot, or
a rate change), put those lines in one **fringe range** so the cutoff is used up across them
instead of starting again on each line. Drag down the **Range** column across those lines, or use
the line panel. The column shows which lines belong together.

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

## 7. Percentages and tax incentives

Both are in **Budget Settings › Percentages** and show on the topsheet.

### Percentages of the budget

Contingency, completion bond, production fee, overhead: amounts worked out as a percentage of the
categories' total and added to the grand total. For each one, set:

- the **account** number it shows under on the topsheet and its **name**,
- the **percent** (use a minus to take something off, e.g. -5),
- **leave out groups:** groups of lines it isn't charged on, such as a bond that excludes
  above-the-line.

The table shows what each is **worked out on** and the **amount**.

### Tax incentives

A tax incentive pays back part of the money you spend in a state or country (section 1). To set
one up:

1. Tag the lines that qualify with a group (Budget Settings › Groups), e.g. "Georgia spend".
2. Add the incentive and pick those groups as its **qualifying groups**.
3. Set the **rate**, e.g. 30 for a 30% credit.
4. Choose whether the qualifying lines' **fringes** count, and which ones. Some programs count
   payroll taxes and benefits, some don't.
5. Set **received**: the share you actually get. If the credit is sold at 80¢ on the dollar, enter 80.

The table shows the **qualifying spend**, the **credit**, and the **amount** you receive. In
Budget Settings › General you choose whether incentives appear under the grand total with a **Net
Cost** line, or are taken off the grand total.

---

## 8. Reports

The **Reports** page builds:

- **Topsheet:** categories, production totals, percentages and the grand total.
- **Changes:** what changed between two saved versions, or since one: the totals on each side,
  the difference, and every change (section 10).
- **Account Summary:** every account with its total, by category.
- **Detail:** every account with its lines, fringes and totals.
- **Crew List:** the budget's labor on its own (section 9).
- **Fringes:** each fringe: its rate, cutoff, what it applies to and what it comes to.
- **Globals:** each global, its formula and what it works out to.
- **Groups**, **Sets** and **Locations:** what the lines in each add up to.
- **Assumptions:** the assumptions page.

Tick the reports you want and drag them (or Alt+↑/↓) into the order they print in. The options:

- **Leave out what comes to zero.**
- **Show fringe detail:** the Detail lists each fringe with its rate and what it applies to,
  instead of one Fringes line.
- **Landscape (PDF).**
- **Production levels:** print only, say, below-the-line in the Account Summary and Detail. None
  ticked prints them all.

The title printed at the top comes from Budget Settings › General. Check the preview, then
**Save PDF…**, **Save Excel…** or **Save JSON…**.

**Export CSV…** saves every account's number, name and total, then the topsheet amounts, for
bringing into another program such as an accounting system.

---

## 9. Crew List

The **Crew List** page shows the budget's labor on its own: each position's rate, time, wages and
fringes, with the number of positions, total wages, total fringes and the labor total as a share
of the budget. Producers use it to see what the crew costs and to plan hiring.

**Who counts as crew:** a line is on the crew list when it has one of the fringes you tick.
Workers' compensation works best, because people on payroll and **loan-outs** (crew paid through
their own company) carry it, while box and kit rentals (a crew member's own equipment, paid as a
rental) don't.

Save it with **Save PDF…** or **Save Excel…**, or print it with the other reports.

---

## 10. History and versions

### Undo and redo

**Ctrl+Z** undoes and **Ctrl+Y** redoes (⌘Z and ⇧⌘Z on a Mac). Nothing is ever lost: if you
undo and then make a different change, the old path is kept in History.

### The History page

**History** lists every change, by you or the AI, newest first: what changed, where, the total
after it, and when. Changes the AI made are marked. Click a change to see exactly what it did.
Changes are also marked **Not in a version yet** (made since the last saved version) or **Not in
the budget now** (undone, or after a point you went back to).

Each change has two buttons:

- **Go back to here:** the budget returns to how it was then. Later changes are kept, so you can
  go forward again.
- **Fork from here:** opens a copy of the budget as it was then, as a new budget in its own tab
  and folder, to try something else ("what if we shoot in 25 days?") without touching the
  original. Name it, and it carries its history with it.

### Saving a version

When a draft goes out, click **Save version…** on the History page and fill in:

- **Version:** the number. Fringe suggests the next one, e.g. v1.1 or v2.0.
- **Name:** e.g. "Studio draft".
- **Sent on** and **Sent to:** when and to whom, e.g. "Studio, completion bond".
- **Notes.**
- **What changed** since the last version. **Fill in from the figures** writes it from the
  numbers; or ask the AI in the side panel to write it.
- **Save a PDF of the reports:** saves the reports ticked on the Reports page as a PDF in the
  budget's `versions` folder, so you have exactly what was sent.

### Working with versions

Each saved version shows its total, who it went to and when, its notes and what changed, with:

- **Changes since:** what changed from this version to the budget now.
- **Compare with v…:** this version against the one saved before it.
- **Show PDF:** the PDF saved with it, in its folder.
- **Go back to here:** the budget as it was at this version.
- **Fork:** a new budget starting from this version.
- **Edit** the details, or **Delete** the version. Deleting a version doesn't delete any changes,
  only the bookmark.

### Comparing versions

To see what moved between drafts (say, where the studio's $1M cut landed), open the **Changes**
report. Its **From** and **To** pickers take any two saved versions, or a version and the budget
now. It shows each account's total on both sides and the difference, then every change in detail,
and it prints and exports like the other reports.

There are three ways in:

- **Compare** at the top of the budget page: the latest version against the budget now.
- **Compare with v…** on a version in History: that version against the one saved before it.
- **Changes since** on a version in History: that version against the budget now.

---

## 11. Knowledge

**Knowledge** is where a budget's reference material lives: rate sheets, union agreements, deal
memos (the agreed terms for a person's hire), schedules, and **instructions**: your rules and
decisions for this production ("10-hour days", "use the 2026 rates"). The AI reads them when you
ask it about the budget, and it reads the instructions first.

On the **Knowledge** page:

- **Add Files…**, or drop files on the page or on the AI panel, copies them into the budget's
  `knowledge` folder.
- Click a file's name to open it.
- **Show Folder** opens the folder, where you can add, rename or remove files yourself.
- Standing instructions for this budget go in a file called **instructions.md**. You can also ask
  the AI to remember something, and it adds it there.

### Global Knowledge

Some material applies to every budget: union rate sheets, your company's chart of accounts, house
rules, your usual rate sources. Put it in **Settings › Global Knowledge**. It works like the
Knowledge page: **Add Files…** or drop files on it, and click a name to open it. The files are
copied into the **Global Knowledge** folder in `Documents/Fringe Budgets`, which **Show Folder**
opens. The AI reads them in every budget, alongside that budget's own files.

**Instructions for All Budgets** opens the one instructions file that applies everywhere ("we
always budget 10-hour days").

---

## 12. AI

The AI is optional. It can answer questions about the budget, make changes you describe, explain
a total, write a version's "What changed", draft the assumptions, build add-ons, or convert a
budget from another program.

### Turning it on

Open the AI panel (the **AI** button at the top right, or Ctrl+J). The gear button chooses which AI
Fringe uses:

- **Claude, with your Claude Pro or Max plan,** through Claude Code, Anthropic's app. If it isn't
  installed, the panel links to it. You sign in once on Claude's own page in your browser; Fringe
  never sees your password.
- **An API key** from Anthropic, OpenAI or Google. The company bills you for what the AI reads
  and writes. You type the key yourself; it's stored encrypted on this computer, and **Remove**
  deletes it. Pick the model from the list.

Switching starts a new chat.

### Chatting

Type a question or request, or start from one of the suggestions. While the AI works, the panel
shows each step it takes in plain words, and **Working…**. You can stop it at any time.

- **Add files:** the paperclip, or drop files on the panel. They go into the budget's Knowledge.
- **Changes wait for you.** Before the AI changes the budget, a card says what it wants to do, and
  you click **Allow** or **Don't Allow**. **Allow all in this chat** lets it go ahead without
  asking for the rest of the chat; **Ask me again** turns that off. Changes to instruction files
  always ask.
- Every change the AI makes is a normal History entry, marked as the AI's, that you can undo.
- **New Chat** starts over.
- The terminal button opens Claude Code in a terminal, for people who prefer it.
- Drag the panel's edge to make it wider; double-click the edge for the usual width.

### Which budget it works on

A chat works on one budget: the one showing when you send the first message. The top of the panel
says **Working on** and the budget's name, and a dot pulses on that budget's tab while the AI works.
You can open and look at other budgets in the meantime; the AI keeps working on its own. It can
read every open budget if you ask about one, but it only changes another budget when you tell it
to. When you're looking at a different budget, the panel offers **Switch to** that budget, or pick
one from the **Working on** list. **New Chat** starts on the budget showing.

The AI only sees a budget when you ask it something, and only through the AI company you chose.

### The AI page

The **AI** page in the sidebar has:

- **Open the AI Panel.**
- **Activity:** each thing the AI read or changed, with the time and the budget.
- **What the AI can do:** every tool it has, with the ones that change the budget marked.
- **Advanced: connect another AI app:** for AI apps you run yourself, such as Claude Code in your
  own terminal or any app that supports MCP (a standard way for AI apps to use other programs).
  Tick **Let AI apps on this computer connect to Fringe**, then **Copy Command** and run it once in
  a terminal. The command holds a private key Fringe made; keep it private like a password, and
  click **Make a New Token** if you think someone else has it. Only apps on this computer can
  connect.

### Bringing in a budget from another program

Export the budget from the other program as PDF, Excel, CSV or XML. Then click **Convert a
budget…** on the start page, or add the file to a new budget's Knowledge and ask the AI to convert
it. It builds the budget line by line and works out what the file doesn't say (globals, unit
hours, fringe cutoffs).

Then it shows the **Import Report**: the file's totals next to Fringe's, any account that **still
doesn't match** and why, and what it **worked out**. Click an account to go to it; the report
updates as you fix things. Check what it worked out, and answer its questions.

---

## 13. Add-ons

Add-ons are extra pages built on top of Fringe, such as a cash flow (when money will be spent,
week by week), a hiring plan or a deal-memo tracker. They work on every budget, and what an add-on
keeps for a budget is saved in that budget, with undo.

On the **Add-ons** page:

- **Build one with Claude:** pick one of the ideas, or **Something else…**, and describe what you
  need in the AI panel ("make me a weekly cash flow from the shoot schedule").
- **Your add-ons:** each one can be opened, **Changed with Claude**, shown as a file, or
  removed. Open ones also appear under **Add-ons** in the sidebar.
- **Add from file…** adds an add-on someone sent you; **Open add-ons folder** shows where they're
  kept.

Add-ons run walled off: no internet, no access to your files, and they can't change the budget's
lines. Only add files you trust.

---

## 14. Settings

**Settings** (bottom of the sidebar) holds what applies to the whole app:

- **Appearance:** match the system, light, dark, or a color theme, with a preview.
- **Fringe Rates:** your rate library (section 6).
- **Global Knowledge:** files the AI reads in every budget (section 11).
- **About:** the version you're running.

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
| Alt+↑ / Alt+↓         | Move a report up or down (Reports)  |

---

## Glossary

- **Above-the-line (ATL):** the key creative costs: story rights, writers, producers, director,
  main cast.
- **Account:** a numbered group of lines inside a category, e.g. 3301 Director of Photography.
- **Allow (allowance):** a set amount for something not worked out in detail.
- **Below-the-line (BTL):** the crew, equipment, sets, locations and other costs of shooting.
- **Box or kit rental:** a fee paid to crew members for using their own equipment. It isn't wages,
  so it has no fringes.
- **Category:** a department or area of cost on the topsheet, e.g. 3300 Camera.
- **Chart of accounts:** the numbered list of categories and accounts a budget uses.
- **Completion bond:** insurance that guarantees a film is finished and delivered, priced as a
  percentage of the budget.
- **Contingency:** an amount set aside for the unexpected, usually a percentage of the budget.
- **Cutoff:** the most pay per person in a year that a fringe is charged on.
- **Deal memo:** the agreed terms for hiring a person: rate, dates, credit.
- **Flat:** a fixed fee, not by time.
- **Fork:** a copy of a budget, from any point in its history, to try something else.
- **Fringe:** a cost on top of wages, such as payroll taxes, pension, health, vacation pay or
  workers' compensation.
- **Fringe range:** lines for the same person, so a cutoff is used up across them.
- **Global:** a named number or formula, such as shoot days, used in many lines.
- **Grand total:** the total cost of the budget.
- **Group:** a tag on lines, for reports and tax incentives.
- **Line:** one cost in an account: amount × multiplier × rate.
- **Loan-out:** a crew member's own company, through which they're paid.
- **Location:** a real place you film at.
- **Net cost:** the grand total less tax incentives.
- **Post-production (post):** editing, visual effects, music and sound, after shooting.
- **Prep, shoot, wrap:** before, during and after filming.
- **Production level:** a topsheet subtotal such as above-the-line or below-the-line.
- **Set:** a place built or dressed for filming.
- **Tax incentive:** part of the money spent in a state or country, paid back as a credit or
  rebate.
- **Topsheet:** the one-page summary of a budget.
- **Version:** a saved copy of the budget as it was sent out, e.g. v1.0 to the studio.
- **Workers' compensation:** insurance for injuries at work, charged on payroll.

---

Fringe is free software under the AGPL-3.0 license, and is an independent project.
