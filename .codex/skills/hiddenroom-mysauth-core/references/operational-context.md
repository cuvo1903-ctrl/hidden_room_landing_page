# Operational Context

This file lists project-wide context that must not be invented. If a task requires any of these and the repo does not provide it, ask the user.

## Ask Before Assuming

- Business objectives, revenue priorities, or audience strategy beyond `philosophy-strategy.md`.
- Official roadmap and launch sequence beyond `philosophy-strategy.md`.
- CRM process: lead sources, lifecycle stages, customer segmentation, support SLA, sales ownership.
- ERP process: approval rules, settlement cadence, accounting conventions, operational owner.
- Kairen AI personality, model/provider policy, escalation rules, data retention, and concrete permissions beyond `philosophy-strategy.md`.
- AI agents besides the documented cloud agent.
- Cloudflare configuration details not visible from the Debian host: DNS records beyond the discovered tunnel, concrete cache rules, WAF rules, Workers, Pages, SSL mode, origin rules, and upload-size overrides.
- GitHub Pages deployment process beyond static hosting and `CNAME`.
- Debian production host details beyond `hiddenroom-debian-server/references/server-map.md` and the role described in `philosophy-strategy.md`.
- Access-control policy for real team members, collaborators, clients, artists, partners, admins.
- Store fulfillment policy, refund rules, delivery rules, and product roadmap.
- Ticketing operations: event check-in process, fraud handling, comp policy, box-office process.
- Media editorial policy, publishing workflow, approval workflow, content rights.
- Brand voice rules beyond visible copy, existing CSS/design language, and `philosophy-strategy.md`.

## How To Ask

Ask short, concrete questions tied to the task. Prefer questions that unblock durable documentation.

Examples:

- "What are the official CRM stages for Hidden Room customers?"
- "Which Cloudflare features are actually in use for hiddenroom.mx?"
- "What is Kairen allowed to do autonomously versus only suggest?"
- "What is the current business priority: tickets, store, memberships, media, or ERP stability?"

## How To Record New Answers

When the user provides durable project facts, update this Skill or the relevant area Skill:

- Put project-wide facts here.
- Put implementation-specific facts in the relevant area Skill.
- Run `quick_validate.py` after editing Skills.

