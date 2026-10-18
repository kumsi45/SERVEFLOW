# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: platform-admin-preview.spec.ts >> all fourteen synthetic sections render without platform requests
- Location: tests\e2e\platform-admin-preview.spec.ts:41:1

# Error details

```
Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "Skip to content" [ref=e4] [cursor=pointer]:
    - /url: "#pa-content"
  - banner [ref=e5]:
    - link "ServeFlow Platform" [ref=e6] [cursor=pointer]:
      - /url: /platform-admin/preview/overview
      - img [ref=e7]
      - text: ServeFlow
      - generic [ref=e10]: Platform
    - generic [ref=e11]:
      - button "Switch to dark mode" [ref=e12] [cursor=pointer]:
        - img [ref=e13]
      - link "Exit preview" [ref=e15] [cursor=pointer]:
        - /url: /platform-admin/login
  - generic [ref=e16]:
    - generic [ref=e17]:
      - img [ref=e19]
      - generic [ref=e22]:
        - strong [ref=e23]: Platform workspace
        - generic [ref=e24]: ServeFlow administration
    - navigation "Platform administration" [ref=e25]:
      - paragraph [ref=e26]: Workspace
      - link "Overview" [ref=e27] [cursor=pointer]:
        - /url: /platform-admin/preview/overview
        - img [ref=e28]
        - generic [ref=e33]: Overview
      - link "Applications" [ref=e34] [cursor=pointer]:
        - /url: /platform-admin/preview/applications
        - img [ref=e35]
        - generic [ref=e39]: Applications
      - link "Businesses" [ref=e40] [cursor=pointer]:
        - /url: /platform-admin/preview/businesses
        - img [ref=e41]
        - generic [ref=e45]: Businesses
      - link "Subscriptions & Payments" [ref=e46] [cursor=pointer]:
        - /url: /platform-admin/preview/contracts
        - img [ref=e47]
        - generic [ref=e49]: Subscriptions & Payments
      - link "Users & Access" [ref=e50] [cursor=pointer]:
        - /url: /platform-admin/preview/users
        - img [ref=e51]
        - generic [ref=e56]: Users & Access
      - link "Notifications" [ref=e57] [cursor=pointer]:
        - /url: /platform-admin/preview/notifications
        - img [ref=e58]
        - generic [ref=e61]: Notifications
      - paragraph [ref=e62]: Platform operations
      - button "System & Security" [expanded] [ref=e63] [cursor=pointer]:
        - img [ref=e64]
        - generic [ref=e67]: System & Security
        - img [ref=e68]
      - generic [ref=e70]:
        - link "System Health" [ref=e71] [cursor=pointer]:
          - /url: /platform-admin/preview/system-health
          - generic [ref=e72]: System Health
        - link "Errors & Diagnostics" [ref=e73] [cursor=pointer]:
          - /url: /platform-admin/preview/diagnostics
          - generic [ref=e74]: Errors & Diagnostics
        - link "Integrations" [ref=e75] [cursor=pointer]:
          - /url: /platform-admin/preview/integrations
          - generic [ref=e76]: Integrations
        - link "Backups & Recovery" [ref=e77] [cursor=pointer]:
          - /url: /platform-admin/preview/backups
          - generic [ref=e78]: Backups & Recovery
        - link "Audit Logs" [ref=e79] [cursor=pointer]:
          - /url: /platform-admin/preview/audit-logs
          - generic [ref=e80]: Audit Logs
        - link "Administrators & Access" [ref=e81] [cursor=pointer]:
          - /url: /platform-admin/preview/administrators
          - generic [ref=e82]: Administrators & Access
        - link "Security & Recovery" [ref=e83] [cursor=pointer]:
          - /url: /platform-admin/preview/security
          - generic [ref=e84]: Security & Recovery
    - generic [ref=e85]:
      - generic [ref=e86]: P
      - generic [ref=e87]:
        - strong [ref=e88]: Visual preview
        - generic [ref=e89]: No administrative access
    - button "Collapse sidebar" [ref=e90] [cursor=pointer]:
      - img [ref=e91]
      - generic [ref=e94]: Collapse sidebar
  - main [ref=e95]:
    - generic [ref=e96]:
      - strong [ref=e97]: LOCAL PREVIEW · SYNTHETIC DATA
      - group [ref=e98]:
        - generic "Preview controls" [ref=e99] [cursor=pointer]:
          - img [ref=e100]
          - text: Preview controls
        - option "Populated" [selected]
        - option "Loading"
        - option "Empty"
        - option "Error"
    - generic [ref=e101]:
      - generic [ref=e102]:
        - paragraph [ref=e103]: System & Security
        - heading "Security & Recovery" [level=1] [ref=e104]
        - paragraph [ref=e105]: Review the safeguards protecting your platform and recovery process.
      - button "Refresh" [ref=e106] [cursor=pointer]:
        - img [ref=e107]
        - generic [ref=e112]: Refresh
    - navigation "Workspace sections" [ref=e113]:
      - link "System Health" [ref=e114] [cursor=pointer]:
        - /url: /platform-admin/preview/system-health
      - link "Errors & Diagnostics" [ref=e115] [cursor=pointer]:
        - /url: /platform-admin/preview/diagnostics
      - link "Integrations" [ref=e116] [cursor=pointer]:
        - /url: /platform-admin/preview/integrations
      - link "Backups & Recovery" [ref=e117] [cursor=pointer]:
        - /url: /platform-admin/preview/backups
      - link "Audit Logs" [ref=e118] [cursor=pointer]:
        - /url: /platform-admin/preview/audit-logs
      - link "Administrators & Access" [ref=e119] [cursor=pointer]:
        - /url: /platform-admin/preview/administrators
      - link "Security & Recovery" [ref=e120] [cursor=pointer]:
        - /url: /platform-admin/preview/security
    - generic [ref=e121]:
      - heading "Enforced administrator boundary" [level=2] [ref=e122]
      - paragraph [ref=e123]: Private access requires named authorization, verified recovery and authenticator verification. Preview grants none of these.
      - paragraph [ref=e124]: Administrator authorization is checked in the database for every platform operation. Verified recovery must be recorded through the trusted provisioning procedure. User metadata and tenant roles do not grant access.
      - heading "Unavailable capabilities" [level=2] [ref=e125]
      - paragraph [ref=e126]: New application intake, invitation delivery/acceptance, provisioning, trial activation, contract activation/renewal, suspension/restoration, notification sending and recovery mutations are disabled. No dashboard switch enables them.
    - paragraph [ref=e127]: "Source: Synthetic preview fixture — not platform data · Checked 1/15/2026, 12:30:00 PM"
```