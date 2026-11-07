# Forewarned

Evidence-based pre-mortems for Jira epics, built on Atlassian Forge for Codegeist 2026.

Forewarned imagines that an epic has already failed and shows the most likely reasons, using the team's own Jira history. Every reason cites numbered facts with links to the work items behind them: how comparable epics slipped, how their scope grew, who is spread thin and what is blocking the epic now. It runs as a panel on Jira epics, with an optional Rovo agent that writes the pre-mortem in its own words.

## Try it

Follow [JUDGES_SETUP.md](JUDGES_SETUP.md): install from the link and run it on any epic in about 5 minutes, then import the optional demo history in about 15 more.

## How it works

- **A panel on epics.** A Jira issue panel (`jira:issuePanel`, UI Kit) shows on work items at hierarchy level 1, whatever the site calls its epics.
- **Evidence from the team's own Jira.** A run goes through a Forge queue and reads Jira as the user who asked: finished epics in the same space from the last 12 months, scope growth, open work per person and blockers. Deterministic code turns that into numbered facts (E1, E2, …) and stores them in Forge KVS.
- **Rule-based reasons, always.** Five rules (dependencies, slip, plan length, scope growth, load) turn the facts into at most 5 reasons, each with a likelihood and a mitigation. No AI, and no reason without a fact.
- **An optional Rovo agent.** The Forewarned agent (`rovo:agent` with 5 actions) writes a narrative from the same facts. A validator checks each reason before it is saved: it must cite existing facts and use only numbers and work item keys those facts hold. Reasons that fail are dropped, and the panel says how many.
- **Act on it.** Tick reasons to create Jira tasks under the epic, or write a Confluence page in the structure of Atlassian's premortem template.
- **$0 to run.** No external services, no egress, no AI keys and no Forge LLM. At most 15 runs per site per UTC day, and an unchanged epic reuses its last run for 24 hours.

| Folder | What it holds |
|---|---|
| `src/frontend/` | The epic panel (UI Kit) |
| `src/engine/` | The evidence engine: Jira reads and the facts |
| `src/premortem/` | Runs, rules, the validator, storage, tasks and the Confluence page |
| `src/actions/`, `src/resolvers/` | The Rovo agent's actions and the panel's resolver |
| `scripts/seed/` | The demo history generator |

## Develop

Needs Node.js 22.23.4+ or 24.22.1+ and the Forge CLI (`forge login` first).

```
npm install
npm test          # node:test suites, no site needed
forge deploy
forge install     # pick your site and Jira
```

For the Confluence page, also install the app in Confluence: `forge install -p Confluence`.

## Demo history

`scripts/seed/` generates the demo history: spaces Checkout (CHK) and Platform (PLT) with 194 work items, 5 planted risks and 2 decoys. It is seeded, not real: the history is generated, and the people in our demo are test accounts mapped to the seed's roles. See [scripts/seed/README.md](scripts/seed/README.md).

## Libraries

| Package | Version | Licence |
|---|---|---|
| `@forge/api` | ^8.4.0 | Atlassian Developer Terms |
| `@forge/bridge` | 7.2.1-next.13 | Atlassian Developer Terms |
| `@forge/events` | ^2.1.7 | Atlassian Developer Terms |
| `@forge/kvs` | ^2.1.1 | Atlassian Developer Terms |
| `@forge/react` | 12.4.0-next.3 | Atlassian Developer Terms |
| `@forge/resolver` | 2.0.2-next.0 | Atlassian Developer Terms |
| `react` | ^18.2.0 | MIT |
| `eslint` (development only) | ^8.56.0 | MIT |
| `eslint-plugin-react-hooks` (development only) | ^4.6.0 | MIT |

The `@forge` packages are Atlassian's and come from npm under the terms in their own `LICENSE.txt`; none of their code is copied into this repository.

## Privacy

- **What it reads:** the epic, its child work items, finished epics in the same space from the last 12 months, linked blockers, and the open work of the people on the epic. It reads Jira as the person who asked, also in the background run.
- **What it stores:** the evidence and the report, in Forge storage (KVS) on Atlassian's cloud, until the next run replaces them. The facts can name the people on the epic with their open work counts, and the report keeps the Atlassian account ID of whoever ran or saved it. No tokens or passwords.
- **Who sees it:** only people who can see the epic, and without evidence about work items they can't see. Known limit: on sites that restrict single work items with security levels, counts inside a fact aren't re-checked per reader (details in [JUDGES_SETUP.md](JUDGES_SETUP.md)).
- **What it writes:** Jira tasks or a Confluence page, only when someone clicks, as that person.
- **Where data goes:** nowhere outside Atlassian. No external egress, no AI keys, no Forge LLM; the optional Rovo agent is Atlassian's own AI on your site. Logs hold counts and error codes only.

## Licence

MIT, see [LICENSE](LICENSE). It covers the code in this repository; each library keeps its own licence.
