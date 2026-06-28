# Operational Context

This file lists project-wide context that must not be invented. If a task requires any of these and the repo does not provide it, ask the user.

## Ask Before Assuming

- Hidden Room philosophy beyond "La Casa del Under" and Grupo Mysauth affiliation.
- Business objectives, revenue priorities, or audience strategy.
- Official roadmap and launch sequence.
- CRM process: lead sources, lifecycle stages, customer segmentation, support SLA, sales ownership.
- ERP process: approval rules, settlement cadence, accounting conventions, operational owner.
- Kairen AI purpose, personality, permitted actions, model/provider policy, escalation rules, or data retention.
- AI agents besides the documented cloud agent.
- Cloudflare configuration: DNS records, cache rules, WAF, Workers, Pages, tunnels, origin rules.
- GitHub Pages deployment process beyond static hosting and `CNAME`.
- Debian production host details beyond documented examples.
- Access-control policy for real team members, collaborators, clients, artists, partners, admins.
- Store fulfillment policy, refund rules, delivery rules, and product roadmap.
- Ticketing operations: event check-in process, fraud handling, comp policy, box-office process.
- Media editorial policy, publishing workflow, approval workflow, content rights.
- Brand voice rules beyond visible copy and existing CSS/design language.

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
