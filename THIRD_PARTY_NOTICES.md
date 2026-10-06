# Third-party notices

Agent Office includes code ported or adapted from the open source projects below. Each ported file
starts with a comment that names its source path and commit.

## Paperclip

- Project: https://github.com/paperclipai/paperclip
- Commit: dd868ed125cd709506dd9b29fca640a44d580501
- License: MIT

Files in this repository that contain code ported or adapted from Paperclip:

| File                                                 | Paperclip source                                                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/shell/app-shell.tsx`        | `ui/src/components/Layout.tsx`, `ui/src/context/SidebarContext.tsx`, `ui/src/context/PanelContext.tsx`                        |
| `apps/web/src/components/shell/sidebar.tsx`          | `ui/src/components/Sidebar.tsx`, `ui/src/components/SidebarSection.tsx`, `ui/src/components/primary-sidebar-styles.ts`        |
| `apps/web/src/components/shell/sidebar-nav-item.tsx` | `ui/src/components/SidebarNavItem.tsx`                                                                                        |
| `apps/web/src/components/shell/company-menu.tsx`     | `ui/src/components/SidebarCompanyMenu.tsx`                                                                                    |
| `apps/web/src/components/shell/account-menu.tsx`     | `ui/src/components/SidebarAccountMenu.tsx`                                                                                    |
| `apps/web/src/components/shell/top-bar.tsx`          | `ui/src/components/BreadcrumbBar.tsx`                                                                                         |
| `apps/web/src/components/shell/properties-panel.tsx` | `ui/src/components/PropertiesPanel.tsx`, `ui/src/components/side-panel/SidePanelFrame.tsx`, `ui/src/context/PanelContext.tsx` |
| `apps/web/src/lib/shell.ts`                          | `ui/src/context/SidebarContext.tsx`, `ui/src/context/PanelContext.tsx`                                                        |
| `apps/web/src/lib/theme.ts`                          | `ui/src/context/ThemeContext.tsx`, `ui/src/components/ThemeToggle.tsx`, `ui/index.html`                                       |
| `apps/web/src/components/status.tsx`                 | `ui/src/components/StatusGlyph.tsx`, `ui/src/components/StatusBadge.tsx`                                                      |
| `apps/web/src/lib/status.ts`                         | `ui/src/components/StatusGlyph.tsx`                                                                                           |
| `apps/web/src/components/list-row.tsx`               | `ui/src/components/IssueRow.tsx`, `ui/src/components/EntityRow.tsx`                                                           |
| `apps/web/src/components/page-skeleton.tsx`          | `ui/src/components/PageSkeleton.tsx`                                                                                          |
| `apps/web/src/components/inline-banner.tsx`          | `ui/src/components/InlineBanner.tsx`                                                                                          |
| `apps/web/src/components/states.tsx`                 | `ui/src/components/EmptyState.tsx`                                                                                            |
| `apps/web/src/components/tab-bar.tsx`                | `ui/src/components/PageTabBar.tsx`                                                                                            |
| `apps/web/src/components/ui/tabs.tsx`                | `ui/src/components/ui/tabs.tsx`                                                                                               |

The Paperclip name, logo and illustrations are not used.

License text, as published in the Paperclip repository (`LICENSE`):

```text
MIT License

Copyright (c) 2025 Paperclip AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## shadcn/ui

The components under `apps/web/src/components/ui/` come from shadcn/ui (MIT). Its license text is in
`apps/web/src/components/ui/LICENSE`.
