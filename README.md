<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/fringe-wordmark-dark.svg">
    <img src="docs/brand/fringe-wordmark.svg" alt="Fringe" width="320">
  </picture>
</p>

<p align="center">
  <strong>Production budgeting for film and television.</strong><br>
  Free, open source, local-first, with AI built in.
</p>

<p align="center">
  <a href="https://github.com/Dubanalog/fringe/releases/latest">Download</a> ·
  <a href="https://github.com/Dubanalog/fringe/releases/latest/download/Fringe-Manual.pdf">Manual (PDF)</a> ·
  <a href="docs/manual.md">Manual (web)</a>
</p>

<!-- Launch video: an https://github.com/user-attachments/assets/… link on its own line plays inline. -->

https://github.com/user-attachments/assets/77993ace-5cf0-4616-89a3-9181fa5da7e7

---

Fringe is a budgeting app for the people who build film and TV
budgets. Lay out a budget the familiar way (topsheet, categories, accounts, detail lines) and
Fringe handles the totals, fringes, currencies, versions and reports.

## What it does

- **The budget you know.** Topsheet, categories, accounts and detail lines in a fast, keyboard-first
  grid. Copy and paste with Excel.
- **Fringes done properly.** Percentage and per-hour fringes, wage cutoffs per person, and posting
  to each account, a fringe account per category, or the topsheet.
- **Globals, groups, sets and locations.** Change shoot days once and every line follows; total
  anything by group, set or location.
- **Currencies.** Budget lines in any currency at your rates; totals convert.
- **Contingency, fees and tax incentives** worked out on the topsheet.
- **Every change kept.** Undo anything, go back to any point, save numbered versions and compare
  them account by account.
- **Reports.** Topsheet, account summary, detail, crew list, fringes and more, as PDF or Excel.
- **AI built in, if you want it.** Ask questions about the budget, make changes in plain English,
  or have it convert a budget from another program, checked total by total. Use your own Claude
  plan or an API key; nothing is sent anywhere unless you ask.

## Your files, on your computer

A budget is a folder of plain files you own: no account, no cloud, no subscription. Back it up,
put it in a shared drive, or send it to someone as a single `.fringe` file.

## Install

Download the installer for your computer from the
[latest release](https://github.com/Dubanalog/fringe/releases/latest):

| Computer               | File                     |
| ---------------------- | ------------------------ |
| Windows                | `…-win-x64.exe`          |
| Windows on ARM         | `…-win-arm64.exe`        |
| Mac (Apple Silicon)    | `…-mac-arm64.dmg`        |
| Mac (Intel)            | `…-mac-x64.dmg`          |
| Ubuntu, Debian, Mint   | `.deb`                   |
| Fedora, RHEL, openSUSE | `.rpm`                   |
| Other Linux            | `.AppImage` or `.tar.gz` |

The Windows installer isn't signed yet: if SmartScreen warns, click **More info → Run anyway**.

> Fringe is in early development. Check its figures before you rely on them for a real production.

## Contributing

Developers: see [DEVELOPMENT.md](docs/DEVELOPMENT.md) to build and run Fringe, and
[RELEASING.md](docs/RELEASING.md) for how installers are made.

## License

[AGPL-3.0](LICENSE). Fringe is an independent project and is not affiliated with any commercial
budgeting software vendor.
