/**
 * Individual settings that Settings search can find (#1574).
 *
 * Pages are searched straight from `settingsRoutes`, so they never drift. Rows
 * are listed here by hand because each panel renders its own rows and only the
 * open panel is mounted -- there is nothing to scan for the others.
 *
 * `anchor` is the row's `data-testid`; search scrolls to it after opening the
 * page. `scripts/check-settings-search-index.mjs` fails the pre-push gate when
 * an anchor no longer exists in the renderer, so a renamed or removed row
 * cannot leave a dead entry behind. Keep `name` identical to the on-screen label.
 *
 * Rows that only render conditionally (a platform, a parent toggle) are still
 * listed: the page opens either way, and the jump is skipped when the row is
 * not on screen.
 */

import type { ApplicationSettingsCategory } from './settingsRoutes';

export interface SettingsSearchEntry {
  category: ApplicationSettingsCategory;
  anchor: string;
  name: string;
  description?: string;
  /** Words people search for that the label does not use. */
  keywords?: readonly string[];
}

export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  // ---- Notifications ----
  {
    category: 'notifications',
    anchor: 'setting-completion-sounds',
    name: 'Enable Completion Sounds',
    description: 'Play an audio notification when AI chat or agent completes a response.',
    keywords: ['audio', 'chime'],
  },
  {
    category: 'notifications',
    anchor: 'setting-os-notifications',
    name: 'Enable OS Notifications',
    description: 'Native system notifications when AI completes a response. Respects Do Not Disturb.',
    keywords: ['alerts', 'desktop'],
  },
  {
    category: 'notifications',
    anchor: 'setting-notify-when-focused',
    name: 'Notify Even When Focused',
    description: 'Show notifications even when the app is focused, unless viewing that session.',
  },
  {
    category: 'notifications',
    anchor: 'setting-notify-needs-attention',
    name: 'Notify When Session Needs Attention',
    description: 'Notify when a session is waiting for input (permissions, questions, plan reviews, commits).',
  },

  // ---- Advanced ----
  {
    category: 'advanced',
    anchor: 'setting-application-mode',
    name: 'Application Mode',
    description: 'Choose between a simplified experience or full developer features.',
    keywords: ['developer mode', 'standard mode'],
  },
  {
    category: 'advanced',
    anchor: 'setting-update-channel',
    name: 'Update Channel',
    description: 'Choose which release stream Nimbalyst pulls auto-updates from.',
    keywords: ['release channel', 'alpha', 'stable', 'updates'],
  },
  {
    category: 'advanced',
    anchor: 'setting-multi-project-mode',
    name: 'Multi-project Mode',
    description: 'Open multiple projects in a single window via a project rail.',
    keywords: ['project rail', 'window'],
  },
  {
    category: 'advanced',
    anchor: 'setting-restore-previous-projects',
    name: "Restore last session's projects on launch",
    description: 'Rehydrate the project rail with every project that was open at last close.',
  },
  {
    category: 'advanced',
    anchor: 'setting-analytics',
    name: 'Send Anonymous Usage Data',
    description: 'Help improve Nimbalyst by sending anonymous usage data.',
    keywords: ['analytics', 'telemetry', 'privacy'],
  },
  {
    category: 'advanced',
    anchor: 'setting-spellcheck',
    name: 'Spellcheck',
    description: 'Enable the system spellchecker in editors and text inputs.',
    keywords: ['spelling'],
  },
  {
    category: 'advanced',
    anchor: 'setting-show-chat-providers',
    name: 'Show Chat Providers',
    description: 'Show Claude Chat, OpenAI, and LM Studio in provider settings and new-session model selection.',
  },
  {
    category: 'advanced',
    anchor: 'setting-feature-guides',
    name: 'Show Feature Guides',
    description: 'Walkthrough guides for new features and tips.',
    keywords: ['walkthrough', 'tips', 'onboarding'],
  },
  {
    category: 'advanced',
    anchor: 'setting-link-commits-to-trackers',
    name: 'Link Commits to Tracker Items',
    description: 'Link git commits to tracker items via session relationships and issue key parsing.',
    keywords: ['tracker automation'],
  },
  {
    category: 'advanced',
    anchor: 'setting-close-items-on-commit',
    name: 'Close Items on Fixes/Closes/Resolves',
    description: 'Change tracker item status to done when a commit message uses a closing keyword.',
    keywords: ['tracker automation'],
  },
  {
    category: 'advanced',
    anchor: 'setting-external-editor',
    name: 'External Editor',
    description: "Editor for the 'Open in...' context menu option.",
    keywords: ['vs code', 'cursor', 'vim'],
  },
  {
    category: 'advanced',
    anchor: 'setting-extension-dev-tools',
    name: 'Extension Dev Tools',
    description: 'Enable MCP tools for building, installing, and hot-reloading extensions.',
  },
  {
    category: 'advanced',
    anchor: 'setting-max-heap-size',
    name: 'Max Heap Size',
    description: 'V8 memory limit. Increase if you get out-of-memory crashes. Requires restart.',
    keywords: ['memory', 'ram'],
  },
  {
    category: 'advanced',
    anchor: 'setting-preferred-terminal-shell',
    name: 'Preferred Terminal Shell',
    description: 'Choose which detected Windows shell new terminals should open with.',
    keywords: ['powershell', 'bash', 'windows'],
  },
  {
    category: 'advanced',
    anchor: 'setting-history-retention',
    name: 'History Retention',
    description: 'Max age of file history snapshots before automatic cleanup.',
  },
  {
    category: 'advanced',
    anchor: 'setting-max-snapshots',
    name: 'Max Snapshots Per File',
    description: 'Oldest snapshots beyond this limit are deleted.',
    keywords: ['history'],
  },
  {
    category: 'advanced',
    anchor: 'setting-custom-path',
    name: 'Custom PATH Directories',
    description: 'Additional directories for MCP server installation, CLI tool detection, and agent SDK operations.',
  },

  // ---- Agent Features ----
  {
    category: 'agent-features',
    anchor: 'setting-auto-approve-commits',
    name: 'Auto-approve Commits',
    description: 'Automatically approve when Claude proposes git commits.',
  },
  {
    category: 'agent-features',
    anchor: 'external-session-follow-setting',
    name: 'Follow external agent sessions',
    description: 'Automatically follow Claude Code and Codex CLI sessions in open workspaces and their worktrees.',
  },
  {
    category: 'agent-features',
    anchor: 'show-mcp-session-status-toggle',
    name: 'Show MCP Server Status',
    description: "Show a chip in the session header listing this session's MCP servers.",
  },
  {
    category: 'agent-features',
    anchor: 'setting-preferred-agent-language',
    name: 'Preferred Agent Language',
    description: 'Preferred language for AI-generated session names.',
    keywords: ['session names', 'locale'],
  },
  {
    category: 'agent-features',
    anchor: 'attachment-staging-settings',
    name: 'Attachment staging directory',
    description: 'Choose where files are placed before an agent reads them.',
    keywords: ['attachments', 'temp'],
  },
  {
    category: 'agent-features',
    anchor: 'setting-claude-api-upstream',
    name: 'Custom Claude API upstream',
    description: "Route the Claude Code CLI's API traffic through a local proxy before it reaches Anthropic.",
    keywords: ['proxy', 'gateway'],
  },
  {
    category: 'agent-features',
    anchor: 'setting-agent-workflow-compatibility',
    name: 'Agent skills and commands compatibility',
    description: 'Control which command and skill sources feed the shared picker and which compatibility exports are written.',
    keywords: ['.claude', 'slash commands', 'codex'],
  },
  {
    category: 'agent-features',
    anchor: 'setting-show-tool-calls-in-chat',
    name: 'Show Tool Calls in Chat',
    description: 'Display tool call rows in the AI chat view.',
  },
];
